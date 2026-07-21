use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::Serialize;
use uuid::Uuid;

pub const LOBBY_PROJECT_ID: &str = "project-default-lobby";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfile {
    pub id: String,
    pub slug: String,
    pub display_name: String,
    pub species: String,
    pub role_title: String,
    pub role_contract: String,
    pub accent: String,
    pub runtime_enabled: bool,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub root_path: String,
    pub git_common_dir: String,
    pub created_at: String,
    pub last_opened_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub project_id: String,
    pub owner_agent_id: String,
    pub title: String,
    pub goal: String,
    pub status: String,
    pub execution_root: String,
    pub start_branch: String,
    pub base_revision: String,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSession {
    pub id: String,
    pub task_id: String,
    pub provider: String,
    pub native_thread_id: Option<String>,
    pub session_generation: i64,
    pub codex_version: Option<String>,
    pub cwd: String,
    pub status: String,
    pub started_at: String,
    pub last_seen_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEvent {
    pub id: i64,
    pub task_id: String,
    pub sequence: i64,
    pub event_type: String,
    pub native_method: Option<String>,
    pub payload: serde_json::Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Approval {
    pub id: String,
    pub task_id: String,
    pub native_request_id: String,
    pub approval_type: String,
    pub reason: Option<String>,
    pub request: serde_json::Value,
    pub status: String,
    pub decision: Option<serde_json::Value>,
    pub requested_at: String,
    pub resolved_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct V2RecoverySummary {
    pub runs_waiting_for_recovery: i64,
    pub actions_returned_to_prepared: i64,
    pub actions_marked_unknown: i64,
    pub deliveries_returned_to_pending: i64,
    pub authorization_deliveries_failed_closed: i64,
}

pub struct Database {
    connection: Connection,
    path: PathBuf,
}

impl Database {
    pub fn open(data_dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(data_dir)
            .with_context(|| format!("failed to create data dir {}", data_dir.display()))?;
        let path = data_dir.join("lumen.sqlite");
        let connection = Connection::open(&path)
            .with_context(|| format!("failed to open SQLite at {}", path.display()))?;
        let mut database = Self { connection, path };
        database.migrate()?;
        database.seed_agents()?;
        Ok(database)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn connection(&self) -> &Connection {
        &self.connection
    }

    pub(crate) fn connection_mut(&mut self) -> &mut Connection {
        &mut self.connection
    }

    pub fn prepare_recovery(&self) -> Result<Vec<Task>> {
        let now = chrono::Utc::now().to_rfc3339();
        self.connection.execute(
            r#"
            UPDATE approval
            SET status = 'declined',
                decision_json = '{"reason":"runtime_restarted"}',
                resolved_at = ?1,
                updated_at = ?1
            WHERE status = 'pending' AND action_id IS NULL
            "#,
            [&now],
        )?;
        self.connection.execute(
            r#"
            UPDATE runtime_session
            SET status = 'interrupted', last_seen_at = ?1
            WHERE status IN ('starting', 'ready', 'running', 'waiting_approval')
            "#,
            [&now],
        )?;
        self.connection.execute(
            r#"
            UPDATE task
            SET status = 'recovering', updated_at = ?1
            WHERE status IN ('preparing', 'running', 'waiting_approval', 'recovering')
            "#,
            [&now],
        )?;
        Ok(self
            .list_tasks(None)?
            .into_iter()
            .filter(|task| task.status == "recovering")
            .collect())
    }

    pub fn prepare_v2_recovery(&mut self) -> Result<V2RecoverySummary> {
        let now = chrono::Utc::now().to_rfc3339();
        let transaction = self.connection.transaction()?;
        let actions_returned_to_prepared = transaction.execute(
            r#"
            UPDATE action_execution
            SET status = 'prepared', active_attempt_id = NULL,
                active_attempt_number = NULL,
                execution_lease_owner = NULL,
                execution_lease_expires_at = NULL,
                last_error_code = 'core_restarted_before_dispatch',
                version = version + 1, updated_at = ?1
            WHERE status = 'executing'
              AND dispatch_may_have_started_at IS NULL
            "#,
            [&now],
        )? as i64;
        transaction.execute(
            r#"
            UPDATE action_attempt
            SET outcome = 'not_dispatched', ended_at = ?1
            WHERE outcome IS NULL
              AND action_id IN (
                  SELECT id FROM action_execution
                  WHERE status = 'prepared'
                    AND last_error_code = 'core_restarted_before_dispatch'
              )
            "#,
            [&now],
        )?;
        let actions_marked_unknown = transaction.execute(
            r#"
            UPDATE action_execution
            SET status = 'unknown', unknown_disposition = 'active',
                effect_disposition = 'unknown',
                execution_lease_owner = NULL,
                execution_lease_expires_at = NULL,
                resolution_source = 'reconciler',
                last_error_code = 'core_restarted_after_dispatch_marker',
                next_reconcile_at = ?1,
                version = version + 1, updated_at = ?1
            WHERE status = 'executing'
              AND dispatch_may_have_started_at IS NOT NULL
            "#,
            [&now],
        )? as i64;
        transaction.execute(
            r#"
            UPDATE action_attempt
            SET outcome = 'unknown', ended_at = COALESCE(ended_at, ?1)
            WHERE outcome IS NULL
              AND action_id IN (
                  SELECT id FROM action_execution
                  WHERE status = 'unknown'
                    AND last_error_code = 'core_restarted_after_dispatch_marker'
              )
            "#,
            [&now],
        )?;
        transaction.execute(
            r#"
            UPDATE agent_run
            SET status = 'waiting', wait_reason = 'unknown_action_outcome',
                execution_lease_owner = NULL,
                execution_lease_expires_at = NULL,
                last_error_code = 'core_restarted_with_unknown_action',
                version = version + 1, updated_at = ?1
            WHERE status IN ('running', 'waiting')
              AND EXISTS (
                  SELECT 1 FROM action_execution
                  WHERE action_execution.agent_run_id = agent_run.id
                    AND action_execution.status = 'unknown'
                    AND action_execution.unknown_disposition = 'active'
              )
            "#,
            [&now],
        )?;
        let runs_waiting_for_recovery = transaction.execute(
            r#"
            UPDATE agent_run
            SET status = 'waiting', wait_reason = 'runtime_recovery',
                execution_lease_owner = NULL,
                execution_lease_expires_at = NULL,
                last_error_code = 'core_restarted',
                version = version + 1, updated_at = ?1
            WHERE status = 'running'
            "#,
            [&now],
        )? as i64;
        let deliveries_returned_to_pending = transaction.execute(
            r#"
            UPDATE runtime_delivery_checkpoint
            SET status = 'pending', lease_owner = NULL, lease_expires_at = NULL,
                available_at = ?1, last_error = 'core_restarted_during_delivery',
                version = version + 1, updated_at = ?1
            WHERE status = 'delivering'
              AND delivery_kind IN ('action_result', 'cancellation')
            "#,
            [&now],
        )? as i64;
        let authorization_deliveries_failed_closed = transaction.execute(
            r#"
            UPDATE runtime_delivery_checkpoint
            SET status = 'failed', lease_owner = NULL, lease_expires_at = NULL,
                last_error = 'authorization_delivery_outcome_unknown',
                version = version + 1, updated_at = ?1
            WHERE status = 'delivering'
              AND delivery_kind = 'authorization_resolution'
            "#,
            [&now],
        )? as i64;
        let summary = V2RecoverySummary {
            runs_waiting_for_recovery,
            actions_returned_to_prepared,
            actions_marked_unknown,
            deliveries_returned_to_pending,
            authorization_deliveries_failed_closed,
        };
        if summary.runs_waiting_for_recovery != 0
            || summary.actions_returned_to_prepared != 0
            || summary.actions_marked_unknown != 0
            || summary.deliveries_returned_to_pending != 0
            || summary.authorization_deliveries_failed_closed != 0
        {
            transaction.execute(
                r#"
                INSERT INTO event_log(
                    event_id, event_type, payload_json,
                    actor_type, actor_id, created_at
                ) VALUES (?1, 'runtime.v2_recovery_prepared', ?2,
                          'system', 'runtime-recovery-coordinator', ?3)
                "#,
                params![
                    Uuid::new_v4().to_string(),
                    serde_json::to_string(&summary)?,
                    now,
                ],
            )?;
        }
        transaction.commit()?;
        Ok(summary)
    }

    fn migrate(&mut self) -> Result<()> {
        self.connection.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;
            PRAGMA synchronous = NORMAL;

            CREATE TABLE IF NOT EXISTS schema_migration (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS agent_profile (
                id TEXT PRIMARY KEY,
                slug TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                species TEXT NOT NULL,
                role_title TEXT NOT NULL,
                role_contract TEXT NOT NULL,
                accent TEXT NOT NULL,
                runtime_enabled INTEGER NOT NULL DEFAULT 0,
                visual_state_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS project (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'git',
                root_path TEXT NOT NULL UNIQUE,
                git_common_dir TEXT NOT NULL,
                created_at TEXT NOT NULL,
                last_opened_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS task (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES project(id),
                owner_agent_id TEXT NOT NULL REFERENCES agent_profile(id),
                title TEXT NOT NULL,
                goal TEXT NOT NULL,
                status TEXT NOT NULL,
                execution_root TEXT NOT NULL,
                start_branch TEXT NOT NULL,
                base_revision TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                completed_at TEXT
            );

            CREATE TABLE IF NOT EXISTS runtime_session (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL REFERENCES task(id),
                provider TEXT NOT NULL,
                native_thread_id TEXT,
                session_generation INTEGER NOT NULL DEFAULT 1,
                codex_version TEXT,
                cwd TEXT NOT NULL,
                status TEXT NOT NULL,
                started_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS turn (
                id TEXT PRIMARY KEY,
                runtime_session_id TEXT NOT NULL REFERENCES runtime_session(id),
                native_turn_id TEXT,
                user_input TEXT NOT NULL,
                status TEXT NOT NULL,
                started_at TEXT NOT NULL,
                finished_at TEXT,
                error_json TEXT
            );

            CREATE TABLE IF NOT EXISTS event_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL REFERENCES task(id),
                turn_id TEXT,
                sequence INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                native_method TEXT,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(task_id, sequence)
            );

            CREATE TABLE IF NOT EXISTS approval (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL REFERENCES task(id),
                turn_id TEXT,
                native_request_id TEXT NOT NULL,
                approval_type TEXT NOT NULL,
                reason TEXT,
                request_json TEXT NOT NULL,
                status TEXT NOT NULL,
                decision_json TEXT,
                requested_at TEXT NOT NULL,
                resolved_at TEXT
            );

            CREATE TABLE IF NOT EXISTS artifact (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL REFERENCES task(id),
                kind TEXT NOT NULL,
                title TEXT NOT NULL,
                uri TEXT NOT NULL,
                metadata_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS task_project_idx ON task(project_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS event_task_idx ON event_log(task_id, sequence);
            CREATE INDEX IF NOT EXISTS approval_task_idx ON approval(task_id, requested_at DESC);

            INSERT OR IGNORE INTO schema_migration(version, applied_at)
            VALUES (1, datetime('now'));

            INSERT OR IGNORE INTO schema_migration(version, applied_at)
            VALUES (2, datetime('now'));
            "#,
        )?;
        self.migrate_direct_workspace_columns()?;
        self.connection.execute(
            "INSERT OR IGNORE INTO schema_migration(version, applied_at) VALUES (3, datetime('now'))",
            [],
        )?;
        self.migrate_project_kind()?;
        self.connection.execute(
            "INSERT OR IGNORE INTO schema_migration(version, applied_at) VALUES (4, datetime('now'))",
            [],
        )?;
        self.migrate_domain_event_log()?;
        self.connection.execute(
            "INSERT OR IGNORE INTO schema_migration(version, applied_at) VALUES (5, datetime('now'))",
            [],
        )?;
        self.migrate_collaboration_schema()?;
        self.connection.execute(
            "INSERT OR IGNORE INTO schema_migration(version, applied_at) VALUES (6, datetime('now'))",
            [],
        )?;
        self.migrate_action_safety_schema()?;
        self.connection.execute(
            "INSERT OR IGNORE INTO schema_migration(version, applied_at) VALUES (7, datetime('now'))",
            [],
        )?;
        self.migrate_evidence_read_schema()?;
        self.connection.execute(
            "INSERT OR IGNORE INTO schema_migration(version, applied_at) VALUES (8, datetime('now'))",
            [],
        )?;
        Ok(())
    }

    fn migrate_direct_workspace_columns(&self) -> Result<()> {
        if self.table_has_column("task", "worktree_path")?
            && !self.table_has_column("task", "execution_root")?
        {
            self.connection.execute(
                "ALTER TABLE task RENAME COLUMN worktree_path TO execution_root",
                [],
            )?;
        }
        if self.table_has_column("task", "branch_name")?
            && !self.table_has_column("task", "start_branch")?
        {
            self.connection.execute(
                "ALTER TABLE task RENAME COLUMN branch_name TO start_branch",
                [],
            )?;
        }
        Ok(())
    }

    fn migrate_project_kind(&self) -> Result<()> {
        if !self.table_has_column("project", "kind")? {
            self.connection.execute(
                "ALTER TABLE project ADD COLUMN kind TEXT NOT NULL DEFAULT 'git'",
                [],
            )?;
        }
        Ok(())
    }

    fn migrate_domain_event_log(&mut self) -> Result<()> {
        if self.table_has_column("event_log", "command_id")? {
            return Ok(());
        }

        let transaction = self.connection.transaction()?;
        transaction.execute_batch(
            r#"
            ALTER TABLE event_log RENAME TO event_log_v1;

            CREATE TABLE event_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT UNIQUE,

                task_id TEXT REFERENCES task(id),
                turn_id TEXT,
                sequence INTEGER,
                event_type TEXT NOT NULL,
                native_method TEXT,
                payload_json TEXT NOT NULL,

                camp_id TEXT,
                entity_type TEXT,
                entity_id TEXT,
                actor_type TEXT,
                actor_id TEXT,
                source_agent_run_id TEXT,
                execution_epoch INTEGER,

                command_id TEXT,
                command_type TEXT,
                request_digest TEXT,
                request_digest_version INTEGER,
                result_status TEXT,
                result_code TEXT,
                result_payload_json TEXT,
                result_entity_type TEXT,
                result_entity_id TEXT,

                created_at TEXT NOT NULL,

                CHECK (
                    (event_type = 'command.result'
                        AND command_id IS NOT NULL
                        AND command_type IS NOT NULL
                        AND request_digest IS NOT NULL
                        AND request_digest_version IS NOT NULL
                        AND result_status IS NOT NULL
                        AND result_code IS NOT NULL
                        AND result_payload_json IS NOT NULL)
                    OR
                    (event_type <> 'command.result'
                        AND command_id IS NULL
                        AND command_type IS NULL
                        AND request_digest IS NULL
                        AND request_digest_version IS NULL
                        AND result_status IS NULL
                        AND result_code IS NULL
                        AND result_payload_json IS NULL
                        AND result_entity_type IS NULL
                        AND result_entity_id IS NULL)
                ),
                CHECK (
                    (result_entity_type IS NULL AND result_entity_id IS NULL)
                    OR
                    (result_entity_type IS NOT NULL AND result_entity_id IS NOT NULL)
                )
            );

            INSERT INTO event_log(
                id, event_id, task_id, turn_id, sequence, event_type,
                native_method, payload_json, created_at
            )
            SELECT
                id, NULL, task_id, turn_id, sequence, event_type,
                native_method, payload_json, created_at
            FROM event_log_v1
            ORDER BY id;

            DROP TABLE event_log_v1;

            CREATE UNIQUE INDEX event_task_sequence_unique
                ON event_log(task_id, sequence)
                WHERE task_id IS NOT NULL AND sequence IS NOT NULL;
            CREATE INDEX event_task_idx
                ON event_log(task_id, sequence)
                WHERE task_id IS NOT NULL;
            CREATE UNIQUE INDEX event_command_result_unique
                ON event_log(command_id)
                WHERE command_id IS NOT NULL;
            "#,
        )?;
        transaction.commit()?;
        Ok(())
    }

    fn migrate_collaboration_schema(&mut self) -> Result<()> {
        self.add_column_if_missing("agent_profile", "avatar_ref", "avatar_ref TEXT")?;
        self.add_column_if_missing(
            "agent_profile",
            "instructions",
            "instructions TEXT NOT NULL DEFAULT ''",
        )?;
        self.add_column_if_missing(
            "agent_profile",
            "default_capabilities_json",
            "default_capabilities_json TEXT NOT NULL DEFAULT '[]'",
        )?;
        self.add_column_if_missing("agent_profile", "default_provider", "default_provider TEXT")?;
        self.add_column_if_missing("agent_profile", "default_model", "default_model TEXT")?;
        self.add_column_if_missing(
            "agent_profile",
            "profile_status",
            "profile_status TEXT NOT NULL DEFAULT 'active'",
        )?;
        self.add_column_if_missing(
            "agent_profile",
            "version",
            "version INTEGER NOT NULL DEFAULT 1",
        )?;
        self.add_column_if_missing("agent_profile", "archived_at", "archived_at TEXT")?;

        self.connection.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS camp (
                id TEXT PRIMARY KEY,
                project_path TEXT NOT NULL,

                repository_scope_id TEXT UNIQUE,
                repository_git_common_dir TEXT,
                repository_object_format TEXT,
                repository_internal_ref_namespace TEXT,
                repository_bound_at TEXT,
                repository_relocated_at TEXT,

                default_lead_agent_id TEXT,
                status TEXT NOT NULL CHECK(status IN ('active', 'archived')),
                last_message_sequence INTEGER NOT NULL DEFAULT 0,
                version INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                archived_at TEXT,

                CHECK (
                    (repository_scope_id IS NULL
                        AND repository_git_common_dir IS NULL
                        AND repository_object_format IS NULL
                        AND repository_internal_ref_namespace IS NULL
                        AND repository_bound_at IS NULL)
                    OR
                    (repository_scope_id IS NOT NULL
                        AND repository_git_common_dir IS NOT NULL
                        AND repository_object_format IN ('sha1', 'sha256')
                        AND repository_internal_ref_namespace IS NOT NULL
                        AND repository_bound_at IS NOT NULL)
                )
            );

            CREATE TABLE IF NOT EXISTS camp_member (
                camp_id TEXT NOT NULL REFERENCES camp(id),
                agent_profile_id TEXT NOT NULL REFERENCES agent_profile(id),
                status TEXT NOT NULL CHECK(status IN ('active', 'left')),
                capability_overrides_json TEXT NOT NULL DEFAULT '{}',
                leave_requested_at TEXT,
                leave_request_command_id TEXT,
                pending_default_lead_successor_agent_id TEXT,
                version INTEGER NOT NULL DEFAULT 1,
                joined_at TEXT NOT NULL,
                left_at TEXT,
                PRIMARY KEY(camp_id, agent_profile_id),
                CHECK (
                    (leave_requested_at IS NULL AND leave_request_command_id IS NULL)
                    OR
                    (leave_requested_at IS NOT NULL AND leave_request_command_id IS NOT NULL)
                )
            );

            CREATE TABLE IF NOT EXISTS conversation (
                id TEXT PRIMARY KEY,
                camp_id TEXT NOT NULL REFERENCES camp(id),
                agent_profile_id TEXT NOT NULL REFERENCES agent_profile(id),
                provider_override TEXT,
                model_override TEXT,
                action_permission_profile_ref TEXT,
                native_session_id TEXT,
                summary TEXT,
                summary_through_message_sequence INTEGER NOT NULL DEFAULT 0,
                last_seen_camp_message_sequence INTEGER NOT NULL DEFAULT 0,
                last_message_sequence INTEGER NOT NULL DEFAULT 0,
                version INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(camp_id, agent_profile_id)
            );

            CREATE UNIQUE INDEX IF NOT EXISTS conversation_native_session_unique
                ON conversation(native_session_id)
                WHERE native_session_id IS NOT NULL;

            CREATE TABLE IF NOT EXISTS camp_turn (
                id TEXT PRIMARY KEY,
                camp_id TEXT NOT NULL REFERENCES camp(id),
                trigger_type TEXT NOT NULL
                    CHECK(trigger_type IN ('camp_message', 'inbox_message', 'system_event')),
                trigger_id TEXT NOT NULL,
                status TEXT NOT NULL
                    CHECK(status IN ('running', 'waiting', 'completed', 'failed', 'cancelled')),
                cancel_requested_at TEXT,
                cancel_request_command_id TEXT,
                version INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                ended_at TEXT,
                UNIQUE(camp_id, trigger_type, trigger_id),
                CHECK (
                    (cancel_requested_at IS NULL AND cancel_request_command_id IS NULL)
                    OR
                    (cancel_requested_at IS NOT NULL AND cancel_request_command_id IS NOT NULL)
                ),
                CHECK (
                    (status IN ('completed', 'failed', 'cancelled') AND ended_at IS NOT NULL)
                    OR
                    (status IN ('running', 'waiting') AND ended_at IS NULL)
                )
            );

            CREATE TABLE IF NOT EXISTS agent_run (
                id TEXT PRIMARY KEY,
                camp_turn_id TEXT NOT NULL REFERENCES camp_turn(id),
                conversation_id TEXT NOT NULL REFERENCES conversation(id),
                task_id TEXT REFERENCES task(id),

                trigger_conversation_message_id TEXT,
                input_ready_at TEXT,
                initial_camp_context_through_sequence INTEGER NOT NULL,
                initial_conversation_context_through_sequence INTEGER NOT NULL,

                responsibility_key TEXT NOT NULL,
                responsibility_generation INTEGER NOT NULL DEFAULT 0,
                predecessor_agent_run_id TEXT REFERENCES agent_run(id),
                start_reason TEXT NOT NULL CHECK(start_reason IN ('initial', 'retry', 'rework')),
                purpose TEXT NOT NULL,
                expected_output TEXT NOT NULL,
                completion_role TEXT NOT NULL CHECK(completion_role IN ('required', 'optional')),
                effective_config_json TEXT NOT NULL,
                workspace_json TEXT,

                status TEXT NOT NULL
                    CHECK(status IN ('queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled')),
                wait_reason TEXT,
                wait_deadline_at TEXT,
                idempotency_key TEXT NOT NULL,
                automatic_retry_count INTEGER NOT NULL DEFAULT 0,
                last_error_code TEXT,
                last_error_details_ref TEXT,
                manual_retry_allowed INTEGER NOT NULL DEFAULT 0,
                retry_declined_at TEXT,

                execution_epoch INTEGER NOT NULL DEFAULT 0,
                execution_lease_owner TEXT,
                execution_lease_expires_at TEXT,
                cancel_requested_at TEXT,
                cancel_reason_code TEXT,
                cancel_acknowledged_at TEXT,
                version INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                started_at TEXT,
                ended_at TEXT,
                final_conversation_message_id TEXT,
                final_camp_message_id TEXT,
                updated_at TEXT NOT NULL,

                UNIQUE(camp_turn_id, conversation_id, idempotency_key),
                UNIQUE(camp_turn_id, responsibility_key, responsibility_generation),
                CHECK ((status = 'waiting' AND wait_reason IS NOT NULL) OR status <> 'waiting'),
                CHECK (
                    (execution_lease_owner IS NULL AND execution_lease_expires_at IS NULL)
                    OR
                    (execution_lease_owner IS NOT NULL AND execution_lease_expires_at IS NOT NULL)
                ),
                CHECK (
                    (cancel_requested_at IS NULL AND cancel_reason_code IS NULL)
                    OR
                    (cancel_requested_at IS NOT NULL AND cancel_reason_code IS NOT NULL)
                ),
                CHECK (
                    (status IN ('succeeded', 'failed', 'cancelled') AND ended_at IS NOT NULL)
                    OR
                    (status IN ('queued', 'running', 'waiting') AND ended_at IS NULL)
                )
            );

            CREATE UNIQUE INDEX IF NOT EXISTS agent_run_active_conversation_unique
                ON agent_run(conversation_id)
                WHERE status IN ('running', 'waiting');
            CREATE UNIQUE INDEX IF NOT EXISTS agent_run_predecessor_unique
                ON agent_run(predecessor_agent_run_id)
                WHERE predecessor_agent_run_id IS NOT NULL;
            CREATE INDEX IF NOT EXISTS agent_run_scheduler_idx
                ON agent_run(status, input_ready_at, created_at);

            CREATE TABLE IF NOT EXISTS camp_message (
                id TEXT PRIMARY KEY,
                camp_id TEXT NOT NULL REFERENCES camp(id),
                sequence INTEGER NOT NULL,
                author_type TEXT NOT NULL CHECK(author_type IN ('user', 'agent', 'system')),
                author_id TEXT NOT NULL,
                source_agent_run_id TEXT,
                body TEXT NOT NULL,
                address_mode TEXT NOT NULL CHECK(address_mode IN ('default', 'explicit', 'broadcast')),
                addressed_agent_profile_ids_json TEXT NOT NULL,
                reply_to_camp_message_id TEXT REFERENCES camp_message(id),
                camp_turn_id TEXT REFERENCES camp_turn(id),
                agent_run_id TEXT REFERENCES agent_run(id),
                tombstoned_at TEXT,
                version INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(camp_id, sequence)
            );

            CREATE TABLE IF NOT EXISTS conversation_message (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL REFERENCES conversation(id),
                sequence INTEGER NOT NULL,
                author_type TEXT NOT NULL CHECK(author_type IN ('user', 'agent', 'system')),
                author_id TEXT NOT NULL,
                source_agent_run_id TEXT,
                body TEXT NOT NULL,
                source_camp_message_id TEXT REFERENCES camp_message(id),
                source_inbox_message_id TEXT,
                camp_turn_id TEXT REFERENCES camp_turn(id),
                agent_run_id TEXT REFERENCES agent_run(id),
                created_at TEXT NOT NULL,
                UNIQUE(conversation_id, sequence),
                CHECK (
                    source_camp_message_id IS NULL
                    OR source_inbox_message_id IS NULL
                )
            );

            CREATE UNIQUE INDEX IF NOT EXISTS conversation_message_camp_source_unique
                ON conversation_message(conversation_id, source_camp_message_id)
                WHERE source_camp_message_id IS NOT NULL;
            CREATE UNIQUE INDEX IF NOT EXISTS conversation_message_inbox_source_unique
                ON conversation_message(source_inbox_message_id)
                WHERE source_inbox_message_id IS NOT NULL;

            CREATE TABLE IF NOT EXISTS inbox_message (
                id TEXT PRIMARY KEY,
                camp_id TEXT NOT NULL REFERENCES camp(id),
                sender_agent_id TEXT NOT NULL REFERENCES agent_profile(id),
                recipient_agent_id TEXT NOT NULL REFERENCES agent_profile(id),
                body TEXT NOT NULL,
                references_json TEXT NOT NULL DEFAULT '[]',
                source_conversation_id TEXT NOT NULL REFERENCES conversation(id),
                source_camp_turn_id TEXT REFERENCES camp_turn(id),
                source_agent_run_id TEXT REFERENCES agent_run(id),
                target_conversation_id TEXT NOT NULL REFERENCES conversation(id),
                target_agent_run_id TEXT REFERENCES agent_run(id),
                in_reply_to_message_id TEXT REFERENCES inbox_message(id) ON DELETE SET NULL,
                correlation_id TEXT NOT NULL,
                batch_id TEXT,
                retry_of_message_id TEXT REFERENCES inbox_message(id) ON DELETE SET NULL,
                idempotency_key TEXT NOT NULL,
                recipient_message_id TEXT REFERENCES conversation_message(id),
                delivered_at TEXT,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                available_at TEXT NOT NULL,
                lease_owner TEXT,
                lease_expires_at TEXT,
                expires_at TEXT,
                failed_at TEXT,
                last_error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(camp_id, idempotency_key),
                CHECK(sender_agent_id <> recipient_agent_id),
                CHECK (
                    (lease_owner IS NULL AND lease_expires_at IS NULL)
                    OR
                    (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
                ),
                CHECK (
                    delivered_at IS NULL
                    OR (recipient_message_id IS NOT NULL AND failed_at IS NULL
                        AND lease_owner IS NULL AND lease_expires_at IS NULL)
                ),
                CHECK (
                    failed_at IS NULL
                    OR (delivered_at IS NULL AND last_error IS NOT NULL
                        AND lease_owner IS NULL AND lease_expires_at IS NULL)
                ),
                CHECK(target_agent_run_id IS NULL OR expires_at IS NULL)
            );

            CREATE INDEX IF NOT EXISTS inbox_delivery_idx
                ON inbox_message(delivered_at, failed_at, available_at, lease_expires_at);
            "#,
        )?;

        self.add_column_if_missing(
            "agent_run",
            "final_conversation_message_id",
            "final_conversation_message_id TEXT",
        )?;
        self.add_column_if_missing(
            "agent_run",
            "final_camp_message_id",
            "final_camp_message_id TEXT",
        )?;
        self.connection.execute_batch(
            r#"
            CREATE UNIQUE INDEX IF NOT EXISTS agent_run_final_conversation_message_unique
                ON agent_run(final_conversation_message_id)
                WHERE final_conversation_message_id IS NOT NULL;
            CREATE UNIQUE INDEX IF NOT EXISTS agent_run_final_camp_message_unique
                ON agent_run(final_camp_message_id)
                WHERE final_camp_message_id IS NOT NULL;
            "#,
        )?;

        self.add_column_if_missing("task", "camp_id", "camp_id TEXT REFERENCES camp(id)")?;
        self.add_column_if_missing("task", "objective", "objective TEXT")?;
        self.add_column_if_missing(
            "task",
            "acceptance_criteria_json",
            "acceptance_criteria_json TEXT NOT NULL DEFAULT '[]'",
        )?;
        self.add_column_if_missing(
            "task",
            "assignee_agent_id",
            "assignee_agent_id TEXT REFERENCES agent_profile(id)",
        )?;
        self.add_column_if_missing("task", "source_message_id", "source_message_id TEXT")?;
        self.add_column_if_missing("task", "origin_task_id", "origin_task_id TEXT")?;
        self.add_column_if_missing("task", "created_by_type", "created_by_type TEXT")?;
        self.add_column_if_missing("task", "created_by_id", "created_by_id TEXT")?;
        self.add_column_if_missing(
            "task",
            "created_by_source_agent_run_id",
            "created_by_source_agent_run_id TEXT",
        )?;
        self.add_column_if_missing("task", "dedup_key", "dedup_key TEXT")?;
        self.add_column_if_missing("task", "cancel_requested_at", "cancel_requested_at TEXT")?;
        self.add_column_if_missing(
            "task",
            "cancel_request_command_id",
            "cancel_request_command_id TEXT",
        )?;
        self.add_column_if_missing("task", "version", "version INTEGER NOT NULL DEFAULT 1")?;
        self.add_column_if_missing("task", "closed_at", "closed_at TEXT")?;
        self.add_column_if_missing("task", "archived_at", "archived_at TEXT")?;

        self.connection.execute_batch(
            r#"
            CREATE UNIQUE INDEX IF NOT EXISTS task_camp_dedup_unique
                ON task(camp_id, dedup_key)
                WHERE camp_id IS NOT NULL AND dedup_key IS NOT NULL;
            CREATE INDEX IF NOT EXISTS task_camp_idx
                ON task(camp_id, created_at DESC)
                WHERE camp_id IS NOT NULL;

            CREATE TABLE IF NOT EXISTS task_dependency (
                task_id TEXT NOT NULL REFERENCES task(id),
                depends_on_task_id TEXT NOT NULL REFERENCES task(id),
                created_at TEXT NOT NULL,
                PRIMARY KEY(task_id, depends_on_task_id),
                CHECK(task_id <> depends_on_task_id)
            );

            UPDATE agent_profile
            SET instructions = CASE
                    WHEN instructions = '' THEN role_contract
                    ELSE instructions
                END,
                default_provider = COALESCE(default_provider, 'codex-app-server'),
                default_capabilities_json = CASE slug
                    WHEN 'luoke' THEN '["task.create","task.complete","task.cancel","task.dependency.manage","agent_run.create","agent_run.retry","agent_run.cancel","inbox.send"]'
                    WHEN 'muwa' THEN '["task.create","task.complete","task.cancel","agent_run.create","agent_run.retry","agent_run.cancel","inbox.send","workspace.bind","action.request"]'
                    WHEN 'mianzhi' THEN '["agent_run.create","inbox.send"]'
                    WHEN 'qilu' THEN '["agent_run.create","inbox.send"]'
                    ELSE default_capabilities_json
                END
            WHERE profile_status = 'active';

            INSERT OR IGNORE INTO camp(
                id, project_path,
                repository_scope_id, repository_git_common_dir,
                repository_object_format, repository_internal_ref_namespace,
                repository_bound_at, repository_relocated_at,
                default_lead_agent_id, status, last_message_sequence,
                version, created_at, updated_at, archived_at
            )
            SELECT
                'camp-' || id,
                root_path,
                CASE kind WHEN 'git' THEN 'repository-scope-' || id ELSE NULL END,
                CASE kind WHEN 'git' THEN git_common_dir ELSE NULL END,
                CASE kind WHEN 'git' THEN 'sha1' ELSE NULL END,
                CASE kind WHEN 'git' THEN 'refs/lumen/camps/' || id ELSE NULL END,
                CASE kind WHEN 'git' THEN created_at ELSE NULL END,
                NULL,
                NULL,
                'active',
                0,
                1,
                created_at,
                last_opened_at,
                NULL
            FROM project;

            INSERT OR IGNORE INTO camp_member(
                camp_id, agent_profile_id, status, capability_overrides_json,
                leave_requested_at, leave_request_command_id,
                pending_default_lead_successor_agent_id,
                version, joined_at, left_at
            )
            SELECT
                camp.id, agent_profile.id, 'active', '{}',
                NULL, NULL, NULL, 1, camp.created_at, NULL
            FROM camp
            CROSS JOIN agent_profile
            WHERE camp.status = 'active' AND agent_profile.profile_status = 'active';

            INSERT OR IGNORE INTO conversation(
                id, camp_id, agent_profile_id,
                provider_override, model_override, action_permission_profile_ref,
                native_session_id, summary,
                summary_through_message_sequence,
                last_seen_camp_message_sequence, last_message_sequence,
                version, created_at, updated_at
            )
            SELECT
                'conversation-' || camp_member.camp_id || '-' || camp_member.agent_profile_id,
                camp_member.camp_id,
                camp_member.agent_profile_id,
                NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 1,
                camp_member.joined_at, camp_member.joined_at
            FROM camp_member;

            UPDATE camp
            SET default_lead_agent_id = 'agent-muwa'
            WHERE status = 'active'
              AND default_lead_agent_id IS NULL
              AND EXISTS (
                  SELECT 1 FROM camp_member
                  WHERE camp_member.camp_id = camp.id
                    AND camp_member.agent_profile_id = 'agent-muwa'
                    AND camp_member.status = 'active'
                    AND camp_member.leave_requested_at IS NULL
              );

            UPDATE task
            SET camp_id = COALESCE(camp_id, 'camp-' || project_id),
                objective = COALESCE(objective, goal),
                assignee_agent_id = COALESCE(assignee_agent_id, owner_agent_id),
                created_by_type = COALESCE(created_by_type, 'system'),
                created_by_id = COALESCE(created_by_id, 'v0.02-migration')
            WHERE camp_id IS NULL;

            UPDATE conversation
            SET native_session_id = (
                    SELECT runtime_session.native_thread_id
                    FROM runtime_session
                    JOIN task ON task.id = runtime_session.task_id
                    WHERE task.camp_id = conversation.camp_id
                      AND task.owner_agent_id = conversation.agent_profile_id
                      AND runtime_session.native_thread_id IS NOT NULL
                    ORDER BY runtime_session.last_seen_at DESC,
                             runtime_session.session_generation DESC
                    LIMIT 1
                ),
                updated_at = CASE
                    WHEN EXISTS (
                        SELECT 1
                        FROM runtime_session
                        JOIN task ON task.id = runtime_session.task_id
                        WHERE task.camp_id = conversation.camp_id
                          AND task.owner_agent_id = conversation.agent_profile_id
                          AND runtime_session.native_thread_id IS NOT NULL
                    ) THEN datetime('now')
                    ELSE updated_at
                END
            WHERE native_session_id IS NULL
              AND EXISTS (
                  SELECT 1
                  FROM runtime_session
                  JOIN task ON task.id = runtime_session.task_id
                  WHERE task.camp_id = conversation.camp_id
                    AND task.owner_agent_id = conversation.agent_profile_id
                    AND runtime_session.native_thread_id IS NOT NULL
              );
            "#,
        )?;

        Ok(())
    }

    fn migrate_action_safety_schema(&mut self) -> Result<()> {
        self.connection.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS action_execution (
                id TEXT PRIMARY KEY,
                agent_run_id TEXT NOT NULL REFERENCES agent_run(id),
                action_kind TEXT NOT NULL,
                action_schema_version TEXT NOT NULL,
                action_digest TEXT NOT NULL,
                digest_algorithm TEXT NOT NULL,
                canonicalization_version TEXT NOT NULL,
                canonical_input_json TEXT NOT NULL,
                input_completeness TEXT NOT NULL CHECK(input_completeness IN ('complete', 'partial')),
                action_summary TEXT NOT NULL,
                execution_authority TEXT NOT NULL CHECK(execution_authority IN ('core', 'runtime', 'external')),
                control_mode TEXT NOT NULL CHECK(control_mode IN ('mediated', 'intercepted', 'observed')),
                native_action_id TEXT,
                first_observed_at TEXT,
                execute_before TEXT,
                policy_decision TEXT NOT NULL CHECK(policy_decision IN ('allow', 'ask', 'deny', 'observed')),
                policy_version TEXT NOT NULL,
                matched_policy_rule_ids_json TEXT NOT NULL DEFAULT '[]',
                status TEXT NOT NULL
                    CHECK(status IN ('prepared', 'executing', 'succeeded', 'failed', 'unknown', 'not_executed')),
                not_executed_reason TEXT,
                unknown_disposition TEXT CHECK(unknown_disposition IN ('active', 'abandoned')),
                attempt_count INTEGER NOT NULL DEFAULT 0,
                active_attempt_id TEXT,
                active_attempt_number INTEGER,
                action_execution_epoch INTEGER NOT NULL DEFAULT 0,
                agent_run_execution_epoch_at_dispatch INTEGER,
                execution_lease_owner TEXT,
                execution_lease_expires_at TEXT,
                dispatch_may_have_started_at TEXT,
                next_dispatch_at TEXT,
                cancel_requested_at TEXT,
                external_idempotency_key TEXT,
                idempotency_derivation_version TEXT,
                external_operation_id TEXT,
                result_code TEXT,
                result_schema_version TEXT,
                result_summary TEXT,
                result_data_json TEXT,
                result_blob_id TEXT,
                result_digest TEXT,
                effect_disposition TEXT CHECK(effect_disposition IN ('none', 'complete', 'partial', 'unknown')),
                resolution_source TEXT CHECK(resolution_source IN ('executor', 'runtime', 'reconciler', 'user')),
                resolution_evidence_refs_json TEXT NOT NULL DEFAULT '[]',
                last_error_code TEXT,
                next_reconcile_at TEXT,
                version INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                started_at TEXT,
                ended_at TEXT,
                updated_at TEXT NOT NULL,
                UNIQUE(agent_run_id, native_action_id),
                CHECK(control_mode = 'observed' OR input_completeness = 'complete'),
                CHECK(control_mode <> 'observed' OR first_observed_at IS NOT NULL),
                CHECK (
                    (execution_lease_owner IS NULL AND execution_lease_expires_at IS NULL)
                    OR
                    (execution_lease_owner IS NOT NULL AND execution_lease_expires_at IS NOT NULL)
                ),
                CHECK (
                    (status = 'unknown' AND unknown_disposition IS NOT NULL)
                    OR
                    (status <> 'unknown' AND unknown_disposition IS NULL)
                ),
                CHECK (
                    (status = 'not_executed'
                        AND not_executed_reason IS NOT NULL
                        AND effect_disposition = 'none')
                    OR status <> 'not_executed'
                ),
                CHECK (
                    (status IN ('succeeded', 'failed', 'not_executed') AND ended_at IS NOT NULL)
                    OR
                    (status IN ('prepared', 'executing', 'unknown') AND ended_at IS NULL)
                )
            );

            CREATE INDEX IF NOT EXISTS action_execution_dispatch_idx
                ON action_execution(status, policy_decision, next_dispatch_at, execute_before);
            CREATE INDEX IF NOT EXISTS action_execution_reconcile_idx
                ON action_execution(status, unknown_disposition, next_reconcile_at);

            CREATE TABLE IF NOT EXISTS action_attempt (
                id TEXT PRIMARY KEY,
                action_id TEXT NOT NULL REFERENCES action_execution(id),
                attempt_number INTEGER NOT NULL,
                action_execution_epoch INTEGER NOT NULL,
                lease_owner TEXT NOT NULL,
                dispatch_may_have_started_at TEXT,
                external_operation_id TEXT,
                outcome TEXT CHECK(outcome IN ('succeeded', 'failed', 'unknown', 'not_dispatched')),
                started_at TEXT NOT NULL,
                ended_at TEXT,
                UNIQUE(action_id, attempt_number)
            );

            CREATE TABLE IF NOT EXISTS runtime_delivery_checkpoint (
                id TEXT PRIMARY KEY,
                agent_run_id TEXT NOT NULL REFERENCES agent_run(id),
                action_id TEXT REFERENCES action_execution(id),
                delivery_kind TEXT NOT NULL
                    CHECK(delivery_kind IN ('authorization_resolution', 'action_result', 'cancellation')),
                payload_digest TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                target_execution_epoch INTEGER NOT NULL,
                native_request_id TEXT,
                status TEXT NOT NULL
                    CHECK(status IN ('pending', 'delivering', 'acked', 'safely_closed', 'failed')),
                attempt_count INTEGER NOT NULL DEFAULT 0,
                available_at TEXT NOT NULL,
                lease_owner TEXT,
                lease_expires_at TEXT,
                acked_at TEXT,
                safely_closed_at TEXT,
                last_error TEXT,
                version INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(action_id, delivery_kind, payload_digest),
                CHECK (
                    (lease_owner IS NULL AND lease_expires_at IS NULL)
                    OR
                    (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
                )
            );

            CREATE INDEX IF NOT EXISTS runtime_delivery_pending_idx
                ON runtime_delivery_checkpoint(status, available_at, lease_expires_at);
            "#,
        )?;

        if !self.table_has_column("approval", "action_id")? {
            let transaction = self.connection.transaction()?;
            transaction.execute_batch(
                r#"
                ALTER TABLE approval RENAME TO approval_v1;

                CREATE TABLE approval (
                    id TEXT PRIMARY KEY,
                    task_id TEXT REFERENCES task(id),
                    turn_id TEXT,
                    native_request_id TEXT,
                    approval_type TEXT,
                    reason TEXT,
                    request_json TEXT,
                    decision_json TEXT,

                    action_id TEXT UNIQUE REFERENCES action_execution(id),
                    action_kind TEXT,
                    action_digest TEXT,
                    digest_algorithm TEXT,
                    canonicalization_version TEXT,
                    action_summary TEXT,
                    requested_for_user_id TEXT,
                    request_policy_version TEXT,
                    matched_policy_rule_id TEXT,

                    status TEXT NOT NULL
                        CHECK(status IN ('pending', 'approved', 'declined', 'denied', 'cancelled', 'expired')),
                    decision_expires_at TEXT,
                    resolved_by_type TEXT,
                    resolved_by_id TEXT,
                    resolution_code TEXT,
                    resolution_reason TEXT,
                    version INTEGER NOT NULL DEFAULT 1,
                    requested_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    resolved_at TEXT,

                    CHECK (
                        action_id IS NULL
                        OR (action_kind IS NOT NULL
                            AND action_digest IS NOT NULL
                            AND digest_algorithm IS NOT NULL
                            AND canonicalization_version IS NOT NULL
                            AND action_summary IS NOT NULL
                            AND requested_for_user_id IS NOT NULL
                            AND request_policy_version IS NOT NULL)
                    )
                );

                INSERT INTO approval(
                    id, task_id, turn_id, native_request_id, approval_type,
                    reason, request_json, decision_json,
                    action_id, action_kind, action_digest, digest_algorithm,
                    canonicalization_version, action_summary,
                    requested_for_user_id, request_policy_version,
                    matched_policy_rule_id, status, decision_expires_at,
                    resolved_by_type, resolved_by_id, resolution_code,
                    resolution_reason, version, requested_at, updated_at, resolved_at
                )
                SELECT
                    id, task_id, turn_id, native_request_id, approval_type,
                    reason, request_json, decision_json,
                    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
                    status, NULL, NULL, NULL, NULL, NULL, 1,
                    requested_at, COALESCE(resolved_at, requested_at), resolved_at
                FROM approval_v1;

                DROP TABLE approval_v1;
                CREATE INDEX approval_task_idx
                    ON approval(task_id, requested_at DESC)
                    WHERE task_id IS NOT NULL;
                CREATE INDEX approval_pending_action_idx
                    ON approval(status, decision_expires_at)
                    WHERE action_id IS NOT NULL AND status = 'pending';
                "#,
            )?;
            transaction.commit()?;
        }
        Ok(())
    }

    fn migrate_evidence_read_schema(&mut self) -> Result<()> {
        self.add_column_if_missing(
            "task",
            "generation",
            "generation INTEGER NOT NULL DEFAULT 0",
        )?;
        self.add_column_if_missing("event_log", "global_sequence", "global_sequence INTEGER")?;
        self.connection.execute_batch(
            r#"
            UPDATE event_log
            SET global_sequence = (
                SELECT COUNT(*) FROM event_log AS preceding
                WHERE preceding.id <= event_log.id
            )
            WHERE global_sequence IS NULL;

            CREATE TABLE IF NOT EXISTS event_sequence (
                singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
                last_sequence INTEGER NOT NULL
            );

            INSERT INTO event_sequence(singleton, last_sequence)
            VALUES (1, COALESCE((SELECT MAX(global_sequence) FROM event_log), 0))
            ON CONFLICT(singleton) DO UPDATE SET
                last_sequence = MAX(event_sequence.last_sequence, excluded.last_sequence);

            CREATE UNIQUE INDEX IF NOT EXISTS event_global_sequence_unique
                ON event_log(global_sequence)
                WHERE global_sequence IS NOT NULL;

            CREATE TRIGGER IF NOT EXISTS event_log_assign_global_sequence
            AFTER INSERT ON event_log
            WHEN NEW.global_sequence IS NULL
            BEGIN
                UPDATE event_sequence
                SET last_sequence = last_sequence + 1
                WHERE singleton = 1;

                UPDATE event_log
                SET global_sequence = (
                    SELECT last_sequence FROM event_sequence WHERE singleton = 1
                )
                WHERE id = NEW.id;
            END;

            CREATE TABLE IF NOT EXISTS managed_blob (
                id TEXT PRIMARY KEY,
                sha256 TEXT NOT NULL UNIQUE,
                byte_size INTEGER NOT NULL CHECK(byte_size >= 0),
                media_type TEXT NOT NULL,
                storage_relative_path TEXT NOT NULL UNIQUE,
                state TEXT NOT NULL CHECK(state IN ('present', 'missing', 'corrupt')),
                sensitivity TEXT NOT NULL CHECK(sensitivity IN ('normal', 'sensitive')),
                created_at TEXT NOT NULL,
                verified_at TEXT,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS message_attachment (
                id TEXT PRIMARY KEY,
                camp_id TEXT NOT NULL REFERENCES camp(id),
                camp_message_id TEXT REFERENCES camp_message(id),
                conversation_message_id TEXT REFERENCES conversation_message(id),
                blob_id TEXT NOT NULL REFERENCES managed_blob(id),
                display_name TEXT NOT NULL,
                media_type TEXT NOT NULL,
                byte_size INTEGER NOT NULL CHECK(byte_size >= 0),
                created_by_type TEXT NOT NULL CHECK(created_by_type IN ('user', 'agent', 'system')),
                created_by_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                CHECK (
                    (camp_message_id IS NOT NULL AND conversation_message_id IS NULL)
                    OR
                    (camp_message_id IS NULL AND conversation_message_id IS NOT NULL)
                )
            );

            CREATE INDEX IF NOT EXISTS message_attachment_blob_idx
                ON message_attachment(blob_id);
            CREATE INDEX IF NOT EXISTS message_attachment_camp_message_idx
                ON message_attachment(camp_message_id)
                WHERE camp_message_id IS NOT NULL;

            CREATE TABLE IF NOT EXISTS repository_commit_evidence (
                id TEXT PRIMARY KEY,
                camp_id TEXT NOT NULL REFERENCES camp(id),
                repository_scope_id TEXT NOT NULL,
                object_format TEXT NOT NULL CHECK(object_format IN ('sha1', 'sha256')),
                full_oid TEXT NOT NULL,
                retained_ref TEXT NOT NULL,
                verified_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(repository_scope_id, object_format, full_oid)
            );

            CREATE TABLE IF NOT EXISTS task_evidence_binding (
                task_id TEXT NOT NULL REFERENCES task(id),
                task_generation INTEGER NOT NULL,
                criterion_id TEXT NOT NULL,
                evidence_ordinal INTEGER NOT NULL,
                evidence_entity_type TEXT NOT NULL,
                evidence_entity_id TEXT NOT NULL,
                task_version_at_completion INTEGER NOT NULL,
                attested_by_type TEXT NOT NULL CHECK(attested_by_type IN ('user', 'agent', 'system')),
                attested_by_id TEXT NOT NULL,
                source_agent_run_id TEXT,
                semantic_attestation INTEGER NOT NULL CHECK(semantic_attestation = 1),
                created_at TEXT NOT NULL,
                PRIMARY KEY(task_id, task_generation, criterion_id, evidence_ordinal),
                UNIQUE(
                    task_id, task_generation, criterion_id,
                    evidence_entity_type, evidence_entity_id
                )
            );

            CREATE INDEX IF NOT EXISTS task_evidence_entity_idx
                ON task_evidence_binding(evidence_entity_type, evidence_entity_id);
            "#,
        )?;
        Ok(())
    }

    fn add_column_if_missing(&self, table: &str, column: &str, definition: &str) -> Result<()> {
        if !self.table_has_column(table, column)? {
            self.connection
                .execute(&format!("ALTER TABLE {table} ADD COLUMN {definition}"), [])?;
        }
        Ok(())
    }

    fn table_has_column(&self, table: &str, column: &str) -> Result<bool> {
        let mut statement = self
            .connection
            .prepare(&format!("PRAGMA table_info({table})"))?;
        let columns = statement.query_map([], |row| row.get::<_, String>(1))?;
        for candidate in columns {
            if candidate? == column {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn seed_agents(&mut self) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        let profiles = [
            (
                "agent-luoke",
                "luoke",
                "洛可",
                "小熊猫",
                "架构师",
                "澄清目标、约束范围、拆解系统，并维护关键架构决策。",
                "#D56A4A",
                false,
            ),
            (
                "agent-muwa",
                "muwa",
                "沐瓦",
                "水獭",
                "核心开发",
                "直接在用户选择的项目目录中实现代码、运行验证并交付可检查的变更。",
                "#3F8F83",
                true,
            ),
            (
                "agent-mianzhi",
                "mianzhi",
                "眠枝",
                "小角鸮",
                "审查专家",
                "独立检查正确性、风险、回归和证据，不用多数意见掩盖分歧。",
                "#7A6FA8",
                false,
            ),
            (
                "agent-qilu",
                "qilu",
                "绮露",
                "耳廓狐",
                "UI/UX 设计师",
                "在涉及体验时给出交互、视觉、可访问性和平台一致性约束。",
                "#D79B45",
                false,
            ),
        ];

        let transaction = self.connection.transaction()?;
        for profile in profiles {
            transaction.execute(
                r#"
                INSERT OR IGNORE INTO agent_profile (
                    id, slug, display_name, species, role_title, role_contract,
                    accent, runtime_enabled, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
                "#,
                params![
                    profile.0, profile.1, profile.2, profile.3, profile.4, profile.5, profile.6,
                    profile.7, now,
                ],
            )?;
        }
        transaction.commit()?;
        self.connection.execute(
            r#"
            UPDATE agent_profile
            SET role_contract = '直接在用户选择的项目目录中实现代码、运行验证并交付可检查的变更。',
                updated_at = ?1
            WHERE id = 'agent-muwa'
              AND role_contract = '在隔离 Worktree 中实现代码、运行验证并交付可检查的变更。'
            "#,
            [&now],
        )?;
        self.connection.execute(
            r#"
            UPDATE agent_profile
            SET instructions = CASE
                    WHEN instructions = '' THEN role_contract
                    ELSE instructions
                END,
                default_provider = COALESCE(default_provider, 'codex-app-server'),
                default_capabilities_json = CASE slug
                    WHEN 'luoke' THEN '["task.create","task.complete","task.cancel","task.dependency.manage","agent_run.create","agent_run.retry","agent_run.cancel","inbox.send"]'
                    WHEN 'muwa' THEN '["task.create","task.complete","task.cancel","agent_run.create","agent_run.retry","agent_run.cancel","inbox.send","workspace.bind","action.request"]'
                    WHEN 'mianzhi' THEN '["agent_run.create","inbox.send"]'
                    WHEN 'qilu' THEN '["agent_run.create","inbox.send"]'
                    ELSE default_capabilities_json
                END,
                profile_status = CASE
                    WHEN profile_status = 'archived' THEN profile_status
                    ELSE 'active'
                END
            "#,
            [],
        )?;
        Ok(())
    }

    pub fn list_agents(&self) -> Result<Vec<AgentProfile>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT id, slug, display_name, species, role_title, role_contract,
                   accent, runtime_enabled
            FROM agent_profile
            ORDER BY CASE slug
                WHEN 'luoke' THEN 1
                WHEN 'muwa' THEN 2
                WHEN 'mianzhi' THEN 3
                ELSE 4
            END
            "#,
        )?;

        let rows = statement.query_map([], |row| {
            let runtime_enabled: bool = row.get(7)?;
            Ok(AgentProfile {
                id: row.get(0)?,
                slug: row.get(1)?,
                display_name: row.get(2)?,
                species: row.get(3)?,
                role_title: row.get(4)?,
                role_contract: row.get(5)?,
                accent: row.get(6)?,
                runtime_enabled,
                status: if runtime_enabled {
                    "available".to_string()
                } else {
                    "coming_soon".to_string()
                },
            })
        })?;

        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("failed to list agent profiles")
    }

    pub fn upsert_project(&self, root_path: &Path, git_common_dir: &Path) -> Result<Project> {
        let root = root_path.to_string_lossy().to_string();
        let common = git_common_dir.to_string_lossy().to_string();
        let name = root_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Untitled Project")
            .to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let id = Uuid::new_v4().to_string();

        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute(
            r#"
            INSERT INTO project(id, name, kind, root_path, git_common_dir, created_at, last_opened_at)
            VALUES (?1, ?2, 'git', ?3, ?4, ?5, ?5)
            ON CONFLICT(root_path) DO UPDATE SET
                name = excluded.name,
                kind = 'git',
                git_common_dir = excluded.git_common_dir,
                last_opened_at = excluded.last_opened_at
            "#,
            params![id, name, root, common, now],
        )?;
        let project = transaction
            .query_row(
                r#"
                SELECT id, name, kind, root_path, git_common_dir, created_at, last_opened_at
                FROM project WHERE root_path = ?1
                "#,
                [root_path.to_string_lossy().as_ref()],
                project_from_row,
            )
            .context("project was not found after upsert")?;
        materialize_compatibility_camp(&transaction, &project)?;
        transaction.commit()?;
        Ok(project)
    }

    pub fn ensure_lobby_project(&self, root_path: &Path) -> Result<Project> {
        let root = root_path.to_string_lossy().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute(
            r#"
            INSERT INTO project(
                id, name, kind, root_path, git_common_dir, created_at, last_opened_at
            ) VALUES (?1, '默认大厅', 'lobby', ?2, ?3, ?4, ?4)
            ON CONFLICT(id) DO UPDATE SET
                name = '默认大厅',
                kind = 'lobby',
                root_path = excluded.root_path,
                git_common_dir = excluded.git_common_dir
            "#,
            // `git_common_dir` predates context kinds and remains non-null in the
            // MVP schema. Lobby rows repeat their app-owned root here; no Git
            // repository is created or inspected for this context.
            params![LOBBY_PROJECT_ID, root, root, now],
        )?;
        let project = transaction
            .query_row(
                r#"
                SELECT id, name, kind, root_path, git_common_dir, created_at, last_opened_at
                FROM project WHERE id = ?1
                "#,
                [LOBBY_PROJECT_ID],
                project_from_row,
            )
            .context("default lobby was not found after insert")?;
        materialize_compatibility_camp(&transaction, &project)?;
        transaction.commit()?;
        Ok(project)
    }

    pub fn list_projects(&self) -> Result<Vec<Project>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT id, name, kind, root_path, git_common_dir, created_at, last_opened_at
            FROM project
            ORDER BY CASE kind WHEN 'lobby' THEN 0 ELSE 1 END, last_opened_at DESC
            "#,
        )?;
        let rows = statement.query_map([], project_from_row)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("failed to list projects")
    }

    pub fn get_project(&self, id: &str) -> Result<Option<Project>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT id, name, kind, root_path, git_common_dir, created_at, last_opened_at
            FROM project WHERE id = ?1
            "#,
        )?;
        let mut rows = statement.query_map([id], project_from_row)?;
        rows.next().transpose().context("failed to read project")
    }

    #[allow(clippy::too_many_arguments)]
    pub fn insert_task(
        &self,
        id: &str,
        project_id: &str,
        title: &str,
        goal: &str,
        execution_root: &Path,
        start_branch: &str,
        base_revision: &str,
    ) -> Result<Task> {
        let now = chrono::Utc::now().to_rfc3339();
        self.connection.execute(
            r#"
            INSERT INTO task(
                id, project_id, owner_agent_id, title, goal, status,
                execution_root, start_branch, base_revision, created_at, updated_at,
                camp_id, objective, acceptance_criteria_json, assignee_agent_id,
                created_by_type, created_by_id, generation, version
            ) VALUES (
                ?1, ?2, 'agent-muwa', ?3, ?4, 'draft', ?5, ?6, ?7, ?8, ?8,
                'camp-' || ?2, ?4, '[]', 'agent-muwa',
                'system', 'legacy-task-api', 0, 1
            )
            "#,
            params![
                id,
                project_id,
                title,
                goal,
                execution_root.to_string_lossy(),
                start_branch,
                base_revision,
                now,
            ],
        )?;
        self.get_task(id)?
            .context("task was not found after insert")
    }

    pub fn get_task(&self, id: &str) -> Result<Option<Task>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT id, project_id, owner_agent_id, title, goal, status,
                   execution_root, start_branch, base_revision, created_at,
                   updated_at, completed_at
            FROM task WHERE id = ?1
            "#,
        )?;
        let mut rows = statement.query_map([id], task_from_row)?;
        rows.next().transpose().context("failed to read task")
    }

    pub fn list_tasks(&self, project_id: Option<&str>) -> Result<Vec<Task>> {
        if let Some(project_id) = project_id {
            let mut statement = self.connection.prepare(
                r#"
                SELECT id, project_id, owner_agent_id, title, goal, status,
                       execution_root, start_branch, base_revision, created_at,
                       updated_at, completed_at
                FROM task WHERE project_id = ?1 ORDER BY created_at DESC
                "#,
            )?;
            let rows = statement.query_map([project_id], task_from_row)?;
            return rows
                .collect::<rusqlite::Result<Vec<_>>>()
                .context("failed to list tasks");
        }

        let mut statement = self.connection.prepare(
            r#"
            SELECT id, project_id, owner_agent_id, title, goal, status,
                   execution_root, start_branch, base_revision, created_at,
                   updated_at, completed_at
            FROM task ORDER BY created_at DESC
            "#,
        )?;
        let rows = statement.query_map([], task_from_row)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("failed to list tasks")
    }

    pub fn update_task_status(&self, id: &str, status: &str) -> Result<Task> {
        let now = chrono::Utc::now().to_rfc3339();
        self.connection.execute(
            "UPDATE task SET status = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, status, now],
        )?;
        self.get_task(id)?
            .context("task was not found after status update")
    }

    pub fn active_task_for_project(
        &self,
        project_id: &str,
        excluding_task_id: &str,
    ) -> Result<Option<Task>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT id, project_id, owner_agent_id, title, goal, status,
                   execution_root, start_branch, base_revision, created_at,
                   updated_at, completed_at
            FROM task
            WHERE project_id = ?1
              AND id <> ?2
              AND status IN ('preparing', 'running', 'waiting_approval', 'recovering')
            ORDER BY updated_at DESC
            LIMIT 1
            "#,
        )?;
        let mut rows =
            statement.query_map(params![project_id, excluding_task_id], task_from_row)?;
        rows.next()
            .transpose()
            .context("failed to read active project task")
    }

    pub fn ensure_runtime_session(
        &self,
        task_id: &str,
        codex_version: Option<&str>,
        cwd: &Path,
    ) -> Result<RuntimeSession> {
        if let Some(session) = self.get_runtime_session(task_id)? {
            return Ok(session);
        }
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        self.connection.execute(
            r#"
            INSERT INTO runtime_session(
                id, task_id, provider, native_thread_id, session_generation,
                codex_version, cwd, status, started_at, last_seen_at
            ) VALUES (?1, ?2, 'codex-app-server', NULL, 1, ?3, ?4, 'starting', ?5, ?5)
            "#,
            params![id, task_id, codex_version, cwd.to_string_lossy(), now],
        )?;
        self.get_runtime_session(task_id)?
            .context("runtime session was not found after insert")
    }

    pub fn create_next_runtime_session(
        &self,
        task_id: &str,
        codex_version: Option<&str>,
        cwd: &Path,
    ) -> Result<RuntimeSession> {
        let generation: i64 = self.connection.query_row(
            "SELECT COALESCE(MAX(session_generation), 0) + 1 FROM runtime_session WHERE task_id = ?1",
            [task_id],
            |row| row.get(0),
        )?;
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        self.connection.execute(
            r#"
            INSERT INTO runtime_session(
                id, task_id, provider, native_thread_id, session_generation,
                codex_version, cwd, status, started_at, last_seen_at
            ) VALUES (?1, ?2, 'codex-app-server', NULL, ?3, ?4, ?5, 'starting', ?6, ?6)
            "#,
            params![
                id,
                task_id,
                generation,
                codex_version,
                cwd.to_string_lossy(),
                now
            ],
        )?;
        self.get_runtime_session(task_id)?
            .context("new runtime session was not found after insert")
    }

    pub fn get_runtime_session(&self, task_id: &str) -> Result<Option<RuntimeSession>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT id, task_id, provider, native_thread_id, session_generation,
                   codex_version, cwd, status, started_at, last_seen_at
            FROM runtime_session
            WHERE task_id = ?1
            ORDER BY session_generation DESC
            LIMIT 1
            "#,
        )?;
        let mut rows = statement.query_map([task_id], runtime_session_from_row)?;
        rows.next()
            .transpose()
            .context("failed to read runtime session")
    }

    pub fn set_runtime_thread(
        &self,
        session_id: &str,
        native_thread_id: &str,
        status: &str,
    ) -> Result<()> {
        self.connection.execute(
            r#"
            UPDATE runtime_session
            SET native_thread_id = ?2, status = ?3, last_seen_at = ?4
            WHERE id = ?1
            "#,
            params![
                session_id,
                native_thread_id,
                status,
                chrono::Utc::now().to_rfc3339()
            ],
        )?;
        Ok(())
    }

    pub fn set_runtime_status(&self, task_id: &str, status: &str) -> Result<()> {
        self.connection.execute(
            r#"
            UPDATE runtime_session
            SET status = ?2, last_seen_at = ?3
            WHERE task_id = ?1 AND session_generation = (
                SELECT MAX(session_generation) FROM runtime_session WHERE task_id = ?1
            )
            "#,
            params![task_id, status, chrono::Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn record_event(
        &self,
        task_id: &str,
        event_type: &str,
        native_method: Option<&str>,
        payload: &serde_json::Value,
    ) -> Result<TimelineEvent> {
        let sequence: i64 = self.connection.query_row(
            "SELECT COALESCE(MAX(sequence), 0) + 1 FROM event_log WHERE task_id = ?1",
            [task_id],
            |row| row.get(0),
        )?;
        let now = chrono::Utc::now().to_rfc3339();
        self.connection.execute(
            r#"
            INSERT INTO event_log(
                event_id, task_id, turn_id, sequence, event_type,
                native_method, payload_json, created_at
            ) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7)
            "#,
            params![
                Uuid::new_v4().to_string(),
                task_id,
                sequence,
                event_type,
                native_method,
                serde_json::to_string(payload)?,
                now
            ],
        )?;
        let id = self.connection.last_insert_rowid();
        Ok(TimelineEvent {
            id,
            task_id: task_id.to_string(),
            sequence,
            event_type: event_type.to_string(),
            native_method: native_method.map(str::to_string),
            payload: payload.clone(),
            created_at: now,
        })
    }

    pub fn list_events(&self, task_id: &str, limit: i64) -> Result<Vec<TimelineEvent>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT id, task_id, sequence, event_type, native_method, payload_json, created_at
            FROM event_log
            WHERE task_id = ?1
            ORDER BY sequence DESC
            LIMIT ?2
            "#,
        )?;
        let rows = statement.query_map(params![task_id, limit], timeline_event_from_row)?;
        let mut events = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        events.reverse();
        Ok(events)
    }

    pub fn insert_approval(
        &self,
        task_id: &str,
        native_request_id: &str,
        approval_type: &str,
        request: &serde_json::Value,
    ) -> Result<Approval> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let reason = request
            .get("reason")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string);
        self.connection.execute(
            r#"
            INSERT INTO approval(
                id, task_id, turn_id, native_request_id, approval_type, reason,
                request_json, status, requested_at, updated_at
            ) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, 'pending', ?7, ?7)
            "#,
            params![
                id,
                task_id,
                native_request_id,
                approval_type,
                reason,
                serde_json::to_string(request)?,
                now
            ],
        )?;
        self.get_approval(&id)?
            .context("approval was not found after insert")
    }

    pub fn get_approval(&self, id: &str) -> Result<Option<Approval>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT id, task_id, native_request_id, approval_type, reason,
                   request_json, status, decision_json, requested_at, resolved_at
            FROM approval WHERE id = ?1
            "#,
        )?;
        let mut rows = statement.query_map([id], approval_from_row)?;
        rows.next().transpose().context("failed to read approval")
    }

    pub fn list_approvals(&self, task_id: &str) -> Result<Vec<Approval>> {
        let mut statement = self.connection.prepare(
            r#"
            SELECT id, task_id, native_request_id, approval_type, reason,
                   request_json, status, decision_json, requested_at, resolved_at
            FROM approval WHERE task_id = ?1 ORDER BY requested_at DESC
            "#,
        )?;
        let rows = statement.query_map([task_id], approval_from_row)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .context("failed to list approvals")
    }

    pub fn resolve_approval(
        &self,
        id: &str,
        status: &str,
        decision: &serde_json::Value,
    ) -> Result<Approval> {
        self.connection.execute(
            r#"
            UPDATE approval
            SET status = ?2, decision_json = ?3, resolved_at = ?4, updated_at = ?4
            WHERE id = ?1 AND status = 'pending' AND action_id IS NULL
            "#,
            params![
                id,
                status,
                serde_json::to_string(decision)?,
                chrono::Utc::now().to_rfc3339()
            ],
        )?;
        self.get_approval(id)?
            .context("approval was not found after resolve")
    }
}

/// Keeps the v0.01 Project API usable while Camp becomes the v0.02 source of
/// collaboration context. This is a compatibility projection, not a Project
/// aggregate in the v0.02 domain model.
fn materialize_compatibility_camp(transaction: &Transaction<'_>, project: &Project) -> Result<()> {
    let camp_id = format!("camp-{}", project.id);
    let is_repository = project.kind == "git";
    let repository_scope_id = is_repository.then(|| format!("repository-scope-{}", project.id));
    let repository_git_common_dir = is_repository.then_some(project.git_common_dir.as_str());
    let repository_object_format = is_repository.then_some("sha1");
    let repository_internal_ref_namespace =
        is_repository.then(|| format!("refs/lumen/camps/{}", project.id));
    let repository_bound_at = is_repository.then_some(project.created_at.as_str());

    transaction.execute(
        r#"
        INSERT INTO camp(
            id, project_path,
            repository_scope_id, repository_git_common_dir,
            repository_object_format, repository_internal_ref_namespace,
            repository_bound_at, repository_relocated_at,
            default_lead_agent_id, status, last_message_sequence,
            version, created_at, updated_at, archived_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL,
            NULL, 'active', 0, 1, ?8, ?9, NULL
        )
        ON CONFLICT(id) DO UPDATE SET
            project_path = excluded.project_path,
            repository_scope_id = excluded.repository_scope_id,
            repository_git_common_dir = excluded.repository_git_common_dir,
            repository_object_format = excluded.repository_object_format,
            repository_internal_ref_namespace = excluded.repository_internal_ref_namespace,
            repository_bound_at = excluded.repository_bound_at,
            updated_at = excluded.updated_at
        "#,
        params![
            camp_id,
            project.root_path,
            repository_scope_id,
            repository_git_common_dir,
            repository_object_format,
            repository_internal_ref_namespace,
            repository_bound_at,
            project.created_at,
            project.last_opened_at,
        ],
    )?;

    transaction.execute(
        r#"
        INSERT OR IGNORE INTO camp_member(
            camp_id, agent_profile_id, status, capability_overrides_json,
            leave_requested_at, leave_request_command_id,
            pending_default_lead_successor_agent_id,
            version, joined_at, left_at
        )
        SELECT ?1, id, 'active', '{}', NULL, NULL, NULL, 1, ?2, NULL
        FROM agent_profile
        WHERE profile_status = 'active'
        "#,
        params![camp_id, project.created_at],
    )?;
    transaction.execute(
        r#"
        INSERT OR IGNORE INTO conversation(
            id, camp_id, agent_profile_id,
            provider_override, model_override, action_permission_profile_ref,
            native_session_id, summary,
            summary_through_message_sequence,
            last_seen_camp_message_sequence, last_message_sequence,
            version, created_at, updated_at
        )
        SELECT
            'conversation-' || camp_id || '-' || agent_profile_id,
            camp_id, agent_profile_id,
            NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 1,
            joined_at, joined_at
        FROM camp_member
        WHERE camp_id = ?1
        "#,
        [&camp_id],
    )?;

    let replacement_lead = transaction
        .query_row(
            r#"
            SELECT agent_profile_id
            FROM camp_member
            WHERE camp_id = ?1
              AND status = 'active'
              AND leave_requested_at IS NULL
            ORDER BY CASE agent_profile_id WHEN 'agent-muwa' THEN 0 ELSE 1 END,
                     agent_profile_id
            LIMIT 1
            "#,
            [&camp_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    transaction.execute(
        r#"
        UPDATE camp
        SET default_lead_agent_id = ?2
        WHERE id = ?1
          AND NOT EXISTS (
              SELECT 1
              FROM camp_member
              WHERE camp_member.camp_id = camp.id
                AND camp_member.agent_profile_id = camp.default_lead_agent_id
                AND camp_member.status = 'active'
                AND camp_member.leave_requested_at IS NULL
          )
        "#,
        params![camp_id, replacement_lead],
    )?;
    Ok(())
}

fn project_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        kind: row.get(2)?,
        root_path: row.get(3)?,
        git_common_dir: row.get(4)?,
        created_at: row.get(5)?,
        last_opened_at: row.get(6)?,
    })
}

fn task_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get(0)?,
        project_id: row.get(1)?,
        owner_agent_id: row.get(2)?,
        title: row.get(3)?,
        goal: row.get(4)?,
        status: row.get(5)?,
        execution_root: row.get(6)?,
        start_branch: row.get(7)?,
        base_revision: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        completed_at: row.get(11)?,
    })
}

fn runtime_session_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RuntimeSession> {
    Ok(RuntimeSession {
        id: row.get(0)?,
        task_id: row.get(1)?,
        provider: row.get(2)?,
        native_thread_id: row.get(3)?,
        session_generation: row.get(4)?,
        codex_version: row.get(5)?,
        cwd: row.get(6)?,
        status: row.get(7)?,
        started_at: row.get(8)?,
        last_seen_at: row.get(9)?,
    })
}

fn timeline_event_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TimelineEvent> {
    let payload: String = row.get(5)?;
    Ok(TimelineEvent {
        id: row.get(0)?,
        task_id: row.get(1)?,
        sequence: row.get(2)?,
        event_type: row.get(3)?,
        native_method: row.get(4)?,
        payload: serde_json::from_str(&payload).unwrap_or(serde_json::Value::Null),
        created_at: row.get(6)?,
    })
}

fn approval_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Approval> {
    let request: String = row.get(5)?;
    let decision: Option<String> = row.get(7)?;
    Ok(Approval {
        id: row.get(0)?,
        task_id: row.get(1)?,
        native_request_id: row.get(2)?,
        approval_type: row.get(3)?,
        reason: row.get(4)?,
        request: serde_json::from_str(&request).unwrap_or(serde_json::Value::Null),
        status: row.get(6)?,
        decision: decision.and_then(|value| serde_json::from_str(&value).ok()),
        requested_at: row.get(8)?,
        resolved_at: row.get(9)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_database_seeds_durable_companions() {
        let directory = std::env::temp_dir().join(format!("lumen-db-test-{}", Uuid::new_v4()));
        let database = Database::open(&directory).expect("database should open");
        let agents = database.list_agents().expect("agents should load");
        assert_eq!(agents.len(), 4);
        assert_eq!(
            agents.iter().filter(|agent| agent.runtime_enabled).count(),
            1
        );
        assert_eq!(agents[1].slug, "muwa");
        assert!(agents[1].role_contract.contains("项目目录"));
        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn default_lobby_is_a_hidden_context_distinct_from_git_projects() {
        let directory =
            std::env::temp_dir().join(format!("lumen-db-lobby-test-{}", Uuid::new_v4()));
        let lobby_root = directory.join("lobby");
        let project_root = directory.join("project");
        let database = Database::open(&directory).expect("database should open");
        let lobby = database
            .ensure_lobby_project(&lobby_root)
            .expect("lobby should be inserted");
        let project = database
            .upsert_project(&project_root, &project_root.join(".git"))
            .expect("project should be inserted");

        assert_eq!(lobby.id, LOBBY_PROJECT_ID);
        assert_eq!(lobby.kind, "lobby");
        assert_eq!(project.kind, "git");
        let projects = database.list_projects().expect("projects should load");
        assert_eq!(projects[0].id, LOBBY_PROJECT_ID);
        assert!(database.table_has_column("project", "kind").unwrap());
        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn legacy_projects_gain_git_kind_during_migration() {
        let directory = std::env::temp_dir().join(format!("lumen-db-kind-test-{}", Uuid::new_v4()));
        let project_root = directory.join("project");
        let database = Database::open(&directory).expect("database should open");
        let project = database
            .upsert_project(&project_root, &project_root.join(".git"))
            .expect("project should be inserted");
        drop(database);

        let connection =
            Connection::open(directory.join("lumen.sqlite")).expect("database should reopen");
        connection
            .execute_batch(
                r#"
                ALTER TABLE project DROP COLUMN kind;
                DELETE FROM schema_migration WHERE version = 4;
                "#,
            )
            .expect("fixture should use the legacy project schema");
        drop(connection);

        let migrated = Database::open(&directory).expect("legacy database should migrate");
        let project = migrated
            .get_project(&project.id)
            .expect("project lookup should succeed")
            .expect("project should remain available");
        assert_eq!(project.kind, "git");
        drop(migrated);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn legacy_worktree_columns_migrate_without_losing_task_paths() {
        let directory =
            std::env::temp_dir().join(format!("lumen-db-migration-test-{}", Uuid::new_v4()));
        let project_root = directory.join("project");
        let legacy_task_root = directory.join("legacy-task-tree");
        let database = Database::open(&directory).expect("database should open");
        let project = database
            .upsert_project(&project_root, &project_root.join(".git"))
            .expect("project should be inserted");
        database
            .insert_task(
                "legacy-task",
                &project.id,
                "Legacy task",
                "Preserve the old execution directory",
                &legacy_task_root,
                "lumen/task-old",
                "abc123",
            )
            .expect("legacy task fixture should be inserted");
        drop(database);

        let connection =
            Connection::open(directory.join("lumen.sqlite")).expect("legacy database should open");
        connection
            .execute_batch(
                r#"
                ALTER TABLE task RENAME COLUMN execution_root TO worktree_path;
                ALTER TABLE task RENAME COLUMN start_branch TO branch_name;
                DELETE FROM schema_migration WHERE version = 3;
                "#,
            )
            .expect("fixture should use the legacy column names");
        drop(connection);

        let migrated = Database::open(&directory).expect("legacy database should migrate");
        let task = migrated
            .get_task("legacy-task")
            .expect("task should load")
            .expect("task should still exist");
        assert_eq!(task.execution_root, legacy_task_root.to_string_lossy());
        assert_eq!(task.start_branch, "lumen/task-old");
        assert!(migrated.table_has_column("task", "execution_root").unwrap());
        assert!(!migrated.table_has_column("task", "worktree_path").unwrap());
        drop(migrated);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn legacy_events_survive_the_domain_event_log_migration_once() {
        let directory =
            std::env::temp_dir().join(format!("lumen-db-event-test-{}", Uuid::new_v4()));
        let project_root = directory.join("project");
        let database = Database::open(&directory).expect("database should open");
        let project = database
            .upsert_project(&project_root, &project_root.join(".git"))
            .expect("project should be inserted");
        database
            .insert_task(
                "legacy-task",
                &project.id,
                "Legacy event",
                "Preserve the timeline",
                &project_root,
                "main",
                "abc123",
            )
            .expect("task should be inserted");
        database
            .record_event(
                "legacy-task",
                "legacy.event",
                Some("legacy/notification"),
                &serde_json::json!({ "preserved": true }),
            )
            .expect("legacy event should be inserted");
        drop(database);

        let connection =
            Connection::open(directory.join("lumen.sqlite")).expect("database should reopen");
        connection
            .execute_batch(
                r#"
                ALTER TABLE event_log RENAME TO event_log_v2;

                CREATE TABLE event_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL REFERENCES task(id),
                    turn_id TEXT,
                    sequence INTEGER NOT NULL,
                    event_type TEXT NOT NULL,
                    native_method TEXT,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE(task_id, sequence)
                );

                INSERT INTO event_log(
                    id, task_id, turn_id, sequence, event_type,
                    native_method, payload_json, created_at
                )
                SELECT
                    id, task_id, turn_id, sequence, event_type,
                    native_method, payload_json, created_at
                FROM event_log_v2;

                DROP TABLE event_log_v2;
                CREATE INDEX event_task_idx ON event_log(task_id, sequence);
                DELETE FROM schema_migration WHERE version = 5;
                "#,
            )
            .expect("fixture should use the v0.01 event schema");
        drop(connection);

        for _ in 0..2 {
            let migrated = Database::open(&directory).expect("legacy database should migrate");
            let events = migrated
                .list_events("legacy-task", 20)
                .expect("legacy events should remain readable");
            assert_eq!(events.len(), 1);
            assert_eq!(events[0].event_type, "legacy.event");
            assert_eq!(events[0].payload, serde_json::json!({ "preserved": true }));
            assert!(
                migrated
                    .table_has_column("event_log", "command_id")
                    .unwrap()
            );
            let migration_count: i64 = migrated
                .connection
                .query_row(
                    "SELECT COUNT(*) FROM schema_migration WHERE version = 5",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(migration_count, 1);
            drop(migrated);
        }

        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn legacy_project_task_and_native_thread_migrate_into_one_camp_conversation() {
        let directory = std::env::temp_dir().join(format!("lumen-db-camp-test-{}", Uuid::new_v4()));
        let project_root = directory.join("project");
        let database = Database::open(&directory).expect("database should open");
        let project = database
            .upsert_project(&project_root, &project_root.join(".git"))
            .expect("legacy Project should be inserted");
        let task = database
            .insert_task(
                "legacy-camp-task",
                &project.id,
                "Legacy collaboration",
                "Preserve current Codex continuity",
                &project_root,
                "main",
                "abc123",
            )
            .expect("legacy Task should be inserted");
        let session = database
            .ensure_runtime_session(&task.id, Some("0.144.5"), &project_root)
            .expect("legacy RuntimeSession should be inserted");
        database
            .set_runtime_thread(&session.id, "native-thread-legacy", "ready")
            .expect("legacy Native Thread should be bound");
        drop(database);

        let connection =
            Connection::open(directory.join("lumen.sqlite")).expect("database should reopen");
        connection
            .execute("DELETE FROM schema_migration WHERE version = 6", [])
            .expect("fixture should require collaboration migration");
        drop(connection);

        for _ in 0..2 {
            let migrated = Database::open(&directory).expect("legacy data should migrate");
            let (camp_id, native_session_id): (String, Option<String>) = migrated
                .connection
                .query_row(
                    r#"
                    SELECT task.camp_id, conversation.native_session_id
                    FROM task
                    JOIN conversation
                      ON conversation.camp_id = task.camp_id
                     AND conversation.agent_profile_id = task.owner_agent_id
                    WHERE task.id = 'legacy-camp-task'
                    "#,
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .expect("migrated Camp and Conversation should exist");
            assert_eq!(camp_id, format!("camp-{}", project.id));
            assert_eq!(native_session_id.as_deref(), Some("native-thread-legacy"));
            let camp_count: i64 = migrated
                .connection
                .query_row(
                    "SELECT COUNT(*) FROM camp WHERE id = ?1",
                    [&camp_id],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(camp_count, 1);
            drop(migrated);
        }

        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn active_project_task_excludes_the_task_being_resumed() {
        let directory =
            std::env::temp_dir().join(format!("lumen-db-active-test-{}", Uuid::new_v4()));
        let project_root = directory.join("project");
        let database = Database::open(&directory).expect("database should open");
        let project = database
            .upsert_project(&project_root, &project_root.join(".git"))
            .expect("project should be inserted");
        for id in ["task-a", "task-b"] {
            database
                .insert_task(id, &project.id, id, id, &project_root, "main", "abc123")
                .expect("task should be inserted");
        }
        database
            .update_task_status("task-a", "running")
            .expect("task should become active");

        let active = database
            .active_task_for_project(&project.id, "task-b")
            .expect("active task lookup should succeed")
            .expect("another active task should be found");
        assert_eq!(active.id, "task-a");
        assert!(
            database
                .active_task_for_project(&project.id, "task-a")
                .expect("self-excluding lookup should succeed")
                .is_none()
        );
        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }
}
