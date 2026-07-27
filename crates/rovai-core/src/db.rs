use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::Serialize;
use uuid::Uuid;

use crate::context_index::{camp_message_content_digest, extract_context_references};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct V2RecoverySummary {
    pub runs_waiting_for_recovery: i64,
    pub actions_returned_to_prepared: i64,
    pub actions_marked_unknown: i64,
    pub intercepted_actions_failed_closed: i64,
    pub action_approvals_cancelled: i64,
    pub deliveries_returned_to_pending: i64,
    pub authorization_deliveries_failed_closed: i64,
    pub input_deliveries_marked_unknown: i64,
    pub compaction_attempts_requeued: i64,
}

pub struct Database {
    connection: Connection,
    path: PathBuf,
}

fn table_columns(connection: &Connection, table: &str) -> Result<Vec<String>> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    Ok(statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

impl Database {
    pub fn open(data_dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(data_dir)
            .with_context(|| format!("failed to create data dir {}", data_dir.display()))?;
        let preferred_path = data_dir.join("rovai.sqlite");
        let legacy_path = data_dir.join("lumen.sqlite");
        let path = if !preferred_path.exists() && legacy_path.exists() {
            legacy_path
        } else {
            preferred_path
        };
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
        let intercepted_actions_failed_closed = transaction.execute(
            r#"
            UPDATE action_execution
            SET status = 'not_executed',
                not_executed_reason = 'runtime_request_lost',
                effect_disposition = 'none', ended_at = ?1,
                execution_lease_owner = NULL,
                execution_lease_expires_at = NULL,
                version = version + 1, updated_at = ?1
            WHERE status = 'prepared' AND control_mode = 'intercepted'
              AND (
                  EXISTS (
                      SELECT 1 FROM approval
                      WHERE approval.action_id = action_execution.id
                        AND approval.status = 'pending'
                  )
                  OR EXISTS (
                      SELECT 1 FROM runtime_delivery_checkpoint
                      WHERE runtime_delivery_checkpoint.action_id = action_execution.id
                        AND runtime_delivery_checkpoint.delivery_kind = 'authorization_resolution'
                        AND runtime_delivery_checkpoint.status IN ('pending', 'delivering', 'failed')
                  )
              )
            "#,
            [&now],
        )? as i64;
        let action_approvals_cancelled = transaction.execute(
            r#"
            UPDATE approval
            SET status = 'cancelled',
                decision_json = '{"reason":"runtime_request_lost"}',
                resolved_by_type = 'system',
                resolved_by_id = 'runtime-recovery-coordinator',
                resolution_code = 'runtime_request_lost',
                version = version + 1,
                resolved_at = ?1, updated_at = ?1
            WHERE status = 'pending'
              AND action_id IN (
                  SELECT id FROM action_execution
                  WHERE control_mode = 'intercepted'
              )
            "#,
            [&now],
        )? as i64;
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
                runtime_recovery_required = 1,
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
        let input_deliveries_marked_unknown = transaction.execute(
            r#"
            UPDATE runtime_input_delivery
            SET status = 'delivery_unknown',
                last_error = 'core_restarted_after_input_prepared',
                updated_at = ?1
            WHERE status = 'prepared'
            "#,
            [&now],
        )? as i64;
        let compaction_attempts_requeued = transaction.execute(
            r#"
            UPDATE context_compaction_attempt
            SET status = 'queued', started_at = NULL,
                lease_owner = NULL, lease_expires_at = NULL,
                error_code = NULL, error_detail = NULL,
                updated_at = ?1
            WHERE status = 'running'
            "#,
            [&now],
        )? as i64;
        transaction.execute(
            r#"
            UPDATE agent_run
            SET status = 'waiting', wait_reason = 'delivery_unknown',
                runtime_recovery_required = 1,
                execution_lease_owner = NULL,
                execution_lease_expires_at = NULL,
                last_error_code = 'input_delivery_outcome_unknown',
                version = version + 1, updated_at = ?1
            WHERE status IN ('running', 'waiting')
              AND EXISTS (
                  SELECT 1 FROM runtime_input_delivery
                  WHERE runtime_input_delivery.agent_run_id = agent_run.id
                    AND runtime_input_delivery.status = 'delivery_unknown'
              )
            "#,
            [&now],
        )?;
        let runs_waiting_for_recovery = transaction.execute(
            r#"
            UPDATE agent_run
            SET status = 'waiting',
                wait_reason = CASE
                    WHEN status = 'running' THEN 'runtime_recovery'
                    ELSE wait_reason
                END,
                runtime_recovery_required = 1,
                execution_lease_owner = NULL,
                execution_lease_expires_at = NULL,
                last_error_code = CASE
                    WHEN status = 'running' THEN 'core_restarted'
                    ELSE last_error_code
                END,
                version = version + 1, updated_at = ?1
            WHERE status IN ('running', 'waiting')
              AND (
                  runtime_recovery_required = 0
                  OR status = 'running'
                  OR execution_lease_owner IS NOT NULL
              )
              AND NOT EXISTS (
                  SELECT 1 FROM action_execution
                  WHERE action_execution.agent_run_id = agent_run.id
                    AND action_execution.status = 'unknown'
                    AND action_execution.unknown_disposition = 'active'
              )
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
            SET status = 'safely_closed', safely_closed_at = ?1,
                lease_owner = NULL, lease_expires_at = NULL,
                last_error = 'authorization_delivery_outcome_unknown',
                version = version + 1, updated_at = ?1
            WHERE status IN ('pending', 'delivering', 'failed')
              AND delivery_kind = 'authorization_resolution'
              AND action_id IN (
                  SELECT id FROM action_execution
                  WHERE control_mode = 'intercepted'
              )
            "#,
            [&now],
        )? as i64;
        transaction.execute(
            r#"
            UPDATE agent_run
            SET wait_reason = 'runtime_recovery',
                version = version + 1, updated_at = ?1
            WHERE status = 'waiting'
              AND runtime_recovery_required = 1
              AND wait_reason IN ('approval', 'action_execution', 'runtime_delivery')
              AND NOT EXISTS (
                  SELECT 1 FROM approval
                  JOIN action_execution ON action_execution.id = approval.action_id
                  WHERE action_execution.agent_run_id = agent_run.id
                    AND approval.status = 'pending'
              )
              AND NOT EXISTS (
                  SELECT 1 FROM action_execution
                  WHERE action_execution.agent_run_id = agent_run.id
                    AND (
                        action_execution.status IN ('prepared', 'executing')
                        OR (action_execution.status = 'unknown'
                            AND action_execution.unknown_disposition = 'active')
                    )
              )
              AND NOT EXISTS (
                  SELECT 1 FROM runtime_delivery_checkpoint
                  WHERE runtime_delivery_checkpoint.agent_run_id = agent_run.id
                    AND runtime_delivery_checkpoint.status IN ('pending', 'delivering', 'failed')
              )
            "#,
            [&now],
        )?;
        let summary = V2RecoverySummary {
            runs_waiting_for_recovery,
            actions_returned_to_prepared,
            actions_marked_unknown,
            intercepted_actions_failed_closed,
            action_approvals_cancelled,
            deliveries_returned_to_pending,
            authorization_deliveries_failed_closed,
            input_deliveries_marked_unknown,
            compaction_attempts_requeued,
        };
        if summary.runs_waiting_for_recovery != 0
            || summary.actions_returned_to_prepared != 0
            || summary.actions_marked_unknown != 0
            || summary.intercepted_actions_failed_closed != 0
            || summary.action_approvals_cancelled != 0
            || summary.deliveries_returned_to_pending != 0
            || summary.authorization_deliveries_failed_closed != 0
            || summary.input_deliveries_marked_unknown != 0
            || summary.compaction_attempts_requeued != 0
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

            CREATE INDEX IF NOT EXISTS event_task_idx ON event_log(task_id, sequence);
            CREATE INDEX IF NOT EXISTS approval_task_idx ON approval(task_id, requested_at DESC);

            INSERT OR IGNORE INTO schema_migration(version, applied_at)
            VALUES (1, datetime('now'));

            INSERT OR IGNORE INTO schema_migration(version, applied_at)
            VALUES (2, datetime('now'));
            "#,
        )?;
        if self.schema_migration_applied(17)? {
            if !self.schema_migration_applied(18)? {
                self.migrate_task_context_manifest_v18()?;
            }
            if !self.schema_migration_applied(19)? {
                self.migrate_skill_library_v19()?;
            }
            if !self.schema_migration_applied(20)? {
                self.migrate_mcp_exposure_v20()?;
            }
            if !self.schema_migration_applied(21)? {
                self.migrate_memory_v21()?;
            }
            if !self.schema_migration_applied(22)? {
                self.migrate_context_v22()?;
            }
            return Ok(());
        }
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
        if !self.schema_migration_applied(9)? {
            self.migrate_multi_runtime_schema()?;
            self.connection.execute(
                "INSERT INTO schema_migration(version, applied_at) VALUES (9, datetime('now'))",
                [],
            )?;
        }
        if !self.schema_migration_applied(10)? {
            self.migrate_frozen_runtime_execution_schema()?;
            self.connection.execute(
                "INSERT INTO schema_migration(version, applied_at) VALUES (10, datetime('now'))",
                [],
            )?;
        }
        if !self.schema_migration_applied(11)? {
            self.migrate_camp_navigation_schema()?;
            self.connection.execute(
                "INSERT INTO schema_migration(version, applied_at) VALUES (11, datetime('now'))",
                [],
            )?;
        }
        if !self.schema_migration_applied(12)? {
            self.connection.execute_batch(
                r#"
                CREATE INDEX IF NOT EXISTS event_log_camp_global_sequence_idx
                    ON event_log(camp_id, global_sequence)
                    WHERE camp_id IS NOT NULL AND global_sequence IS NOT NULL;
                CREATE INDEX IF NOT EXISTS camp_message_navigation_activity_idx
                    ON camp_message(camp_id, author_type, created_at);
                INSERT INTO schema_migration(version, applied_at)
                VALUES (12, datetime('now'));
                "#,
            )?;
        }
        if !self.schema_migration_applied(13)? {
            self.remove_empty_compatibility_contexts()?;
            self.connection.execute(
                "INSERT INTO schema_migration(version, applied_at) VALUES (13, datetime('now'))",
                [],
            )?;
        }
        if !self.schema_migration_applied(14)? {
            self.migrate_context_and_a2a_schema()?;
            self.connection.execute(
                "INSERT INTO schema_migration(version, applied_at) VALUES (14, datetime('now'))",
                [],
            )?;
        }
        if !self.schema_migration_applied(15)? {
            self.connection.execute(
                "INSERT INTO schema_migration(version, applied_at) VALUES (15, datetime('now'))",
                [],
            )?;
        }
        if !self.schema_migration_applied(16)? {
            self.migrate_runtime_adapter_catalog_v16()?;
            self.connection.execute(
                "INSERT INTO schema_migration(version, applied_at) VALUES (16, datetime('now'))",
                [],
            )?;
        }
        if !self.schema_migration_applied(17)? {
            self.migrate_lightweight_task_v17()?;
        }
        if !self.schema_migration_applied(18)? {
            self.migrate_task_context_manifest_v18()?;
        }
        if !self.schema_migration_applied(19)? {
            self.migrate_skill_library_v19()?;
        }
        if !self.schema_migration_applied(20)? {
            self.migrate_mcp_exposure_v20()?;
        }
        if !self.schema_migration_applied(21)? {
            self.migrate_memory_v21()?;
        }
        if !self.schema_migration_applied(22)? {
            self.migrate_context_v22()?;
        }
        Ok(())
    }

    fn migrate_task_context_manifest_v18(&self) -> Result<()> {
        self.add_column_if_missing(
            "context_manifest",
            "task_context_json",
            "task_context_json TEXT NOT NULL DEFAULT '{\"schemaVersion\":1,\"tasks\":[],\"truncated\":false,\"omittedCount\":0}'",
        )?;
        self.add_column_if_missing(
            "context_manifest",
            "task_context_digest",
            "task_context_digest TEXT NOT NULL DEFAULT 'sha256:legacy-empty-task-context'",
        )?;
        self.connection.execute(
            "INSERT INTO schema_migration(version, applied_at) VALUES (18, datetime('now'))",
            [],
        )?;
        Ok(())
    }

    fn migrate_skill_library_v19(&self) -> Result<()> {
        self.connection.execute_batch(
            r#"
            CREATE TABLE skill (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                source_kind TEXT NOT NULL
                    CHECK(source_kind IN ('bundled', 'imported')),
                enabled INTEGER NOT NULL DEFAULT 0
                    CHECK(enabled IN (0, 1)),
                lifecycle_status TEXT NOT NULL DEFAULT 'active'
                    CHECK(lifecycle_status IN ('active', 'deleting')),
                current_revision_id TEXT REFERENCES skill_revision(id)
                    DEFERRABLE INITIALLY DEFERRED,
                version INTEGER NOT NULL DEFAULT 1
                    CHECK(version >= 1),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deletion_requested_at TEXT
            );

            CREATE TABLE skill_revision (
                id TEXT PRIMARY KEY,
                skill_id TEXT NOT NULL REFERENCES skill(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                content_digest TEXT NOT NULL,
                source_metadata_json TEXT NOT NULL,
                risk_summary_json TEXT NOT NULL,
                file_count INTEGER NOT NULL CHECK(file_count >= 1),
                total_bytes INTEGER NOT NULL CHECK(total_bytes >= 0),
                installed_at TEXT NOT NULL,
                UNIQUE(skill_id, content_digest)
            );

            CREATE INDEX skill_revision_skill_installed_idx
                ON skill_revision(skill_id, installed_at DESC);

            CREATE TABLE skill_projection_observation (
                execution_root TEXT NOT NULL,
                native_root_kind TEXT NOT NULL
                    CHECK(native_root_kind IN ('agents', 'claude', 'antigravity')),
                skill_id TEXT NOT NULL REFERENCES skill(id) ON DELETE CASCADE,
                revision_id TEXT NOT NULL REFERENCES skill_revision(id) ON DELETE CASCADE,
                entry_path TEXT NOT NULL,
                state TEXT NOT NULL
                    CHECK(state IN (
                        'ready', 'stale', 'shadowed', 'unsupported',
                        'pending_removal', 'error'
                    )),
                last_error_code TEXT,
                last_observed_at TEXT NOT NULL,
                PRIMARY KEY(execution_root, native_root_kind, skill_id)
            );

            CREATE INDEX skill_projection_issue_idx
                ON skill_projection_observation(state, last_observed_at DESC);
            "#,
        )?;
        self.add_column_if_missing(
            "context_manifest",
            "skill_exposure_json",
            "skill_exposure_json TEXT NOT NULL DEFAULT '{\"schemaVersion\":1,\"skills\":[]}'",
        )?;
        self.add_column_if_missing(
            "context_manifest",
            "skill_exposure_digest",
            "skill_exposure_digest TEXT NOT NULL DEFAULT 'sha256:legacy-empty-skill-exposure'",
        )?;
        self.connection.execute(
            "INSERT INTO schema_migration(version, applied_at) VALUES (19, datetime('now'))",
            [],
        )?;
        Ok(())
    }

    fn migrate_mcp_exposure_v20(&self) -> Result<()> {
        self.add_column_if_missing(
            "context_manifest",
            "mcp_exposure_json",
            "mcp_exposure_json TEXT NOT NULL DEFAULT '{\"schemaVersion\":1,\"configDigest\":\"sha256:legacy-empty-mcp-config\",\"configStatus\":\"ready\",\"warnings\":[],\"servers\":[]}'",
        )?;
        self.add_column_if_missing(
            "context_manifest",
            "mcp_exposure_digest",
            "mcp_exposure_digest TEXT NOT NULL DEFAULT 'sha256:legacy-empty-mcp-exposure'",
        )?;
        self.add_column_if_missing(
            "context_manifest",
            "mcp_projection_digest",
            "mcp_projection_digest TEXT NOT NULL DEFAULT 'sha256:legacy-empty-mcp-projection'",
        )?;
        self.connection.execute(
            "INSERT INTO schema_migration(version, applied_at) VALUES (20, datetime('now'))",
            [],
        )?;
        Ok(())
    }

    fn migrate_memory_v21(&self) -> Result<()> {
        self.connection.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS memory (
                id TEXT PRIMARY KEY,
                scope_kind TEXT
                    CHECK(scope_kind IN ('hearth', 'companion', 'relationship')),
                kind TEXT
                    CHECK(kind IN ('preference', 'agreement', 'lesson')),
                companion_agent_profile_id TEXT
                    REFERENCES agent_profile(id),
                relationship_agent_low_id TEXT
                    REFERENCES agent_profile(id),
                relationship_agent_high_id TEXT
                    REFERENCES agent_profile(id),
                relationship_direction TEXT
                    CHECK(relationship_direction IN ('mutual', 'directed')),
                directed_actor_agent_profile_id TEXT
                    REFERENCES agent_profile(id),
                lifecycle_status TEXT NOT NULL
                    CHECK(lifecycle_status IN ('active', 'retired', 'forgotten')),
                current_revision_id TEXT
                    REFERENCES memory_revision(id)
                    DEFERRABLE INITIALLY DEFERRED,
                review_after TEXT,
                version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                retired_at TEXT,
                forgotten_at TEXT,
                CHECK (
                    (
                        lifecycle_status = 'forgotten'
                        AND scope_kind IS NULL
                        AND kind IS NULL
                        AND companion_agent_profile_id IS NULL
                        AND relationship_agent_low_id IS NULL
                        AND relationship_agent_high_id IS NULL
                        AND relationship_direction IS NULL
                        AND directed_actor_agent_profile_id IS NULL
                        AND current_revision_id IS NULL
                        AND review_after IS NULL
                        AND forgotten_at IS NOT NULL
                    )
                    OR
                    (
                        lifecycle_status IN ('active', 'retired')
                        AND scope_kind IS NOT NULL
                        AND kind IS NOT NULL
                        AND current_revision_id IS NOT NULL
                        AND forgotten_at IS NULL
                        AND (
                            (
                                scope_kind = 'hearth'
                                AND companion_agent_profile_id IS NULL
                                AND relationship_agent_low_id IS NULL
                                AND relationship_agent_high_id IS NULL
                                AND relationship_direction IS NULL
                                AND directed_actor_agent_profile_id IS NULL
                            )
                            OR
                            (
                                scope_kind = 'companion'
                                AND companion_agent_profile_id IS NOT NULL
                                AND relationship_agent_low_id IS NULL
                                AND relationship_agent_high_id IS NULL
                                AND relationship_direction IS NULL
                                AND directed_actor_agent_profile_id IS NULL
                            )
                            OR
                            (
                                scope_kind = 'relationship'
                                AND companion_agent_profile_id IS NULL
                                AND relationship_agent_low_id IS NOT NULL
                                AND relationship_agent_high_id IS NOT NULL
                                AND relationship_agent_low_id < relationship_agent_high_id
                                AND relationship_direction IS NOT NULL
                                AND kind IN ('agreement', 'lesson')
                                AND (
                                    (
                                        relationship_direction = 'mutual'
                                        AND directed_actor_agent_profile_id IS NULL
                                    )
                                    OR
                                    (
                                        relationship_direction = 'directed'
                                        AND directed_actor_agent_profile_id IN (
                                            relationship_agent_low_id,
                                            relationship_agent_high_id
                                        )
                                    )
                                )
                            )
                        )
                    )
                )
            );

            CREATE INDEX IF NOT EXISTS memory_scope_lifecycle_idx
                ON memory(
                    scope_kind, companion_agent_profile_id,
                    relationship_agent_low_id, relationship_agent_high_id,
                    lifecycle_status, id
                );
            CREATE INDEX IF NOT EXISTS memory_review_due_idx
                ON memory(review_after, id)
                WHERE lifecycle_status = 'active' AND review_after IS NOT NULL;

            CREATE TABLE IF NOT EXISTS memory_revision (
                id TEXT PRIMARY KEY,
                memory_id TEXT NOT NULL
                    REFERENCES memory(id)
                    DEFERRABLE INITIALLY DEFERRED,
                body TEXT,
                body_utf8_bytes INTEGER CHECK(body_utf8_bytes >= 0),
                body_digest TEXT,
                created_from_proposal_id TEXT
                    REFERENCES memory_proposal(id)
                    DEFERRABLE INITIALLY DEFERRED,
                created_at TEXT NOT NULL,
                cleared_at TEXT,
                CHECK (
                    (
                        body IS NOT NULL
                        AND length(body) > 0
                        AND body_utf8_bytes IS NOT NULL
                        AND body_digest IS NOT NULL
                        AND cleared_at IS NULL
                    )
                    OR
                    (
                        body IS NULL
                        AND body_utf8_bytes IS NULL
                        AND body_digest IS NULL
                        AND cleared_at IS NOT NULL
                    )
                )
            );

            CREATE INDEX IF NOT EXISTS memory_revision_memory_created_idx
                ON memory_revision(memory_id, created_at DESC, id);

            CREATE TABLE IF NOT EXISTS memory_proposal (
                id TEXT PRIMARY KEY,
                action TEXT NOT NULL CHECK(action IN ('add', 'revise')),
                status TEXT NOT NULL
                    CHECK(status IN ('pending', 'accepted', 'rejected')),
                candidate_scope_kind TEXT
                    CHECK(candidate_scope_kind IN ('hearth', 'companion', 'relationship')),
                candidate_kind TEXT
                    CHECK(candidate_kind IN ('preference', 'agreement', 'lesson')),
                candidate_companion_agent_profile_id TEXT,
                candidate_relationship_agent_low_id TEXT,
                candidate_relationship_agent_high_id TEXT,
                candidate_relationship_direction TEXT
                    CHECK(candidate_relationship_direction IN ('mutual', 'directed')),
                candidate_directed_actor_agent_profile_id TEXT,
                candidate_body TEXT,
                candidate_body_utf8_bytes INTEGER CHECK(candidate_body_utf8_bytes >= 0),
                target_memory_id TEXT REFERENCES memory(id),
                base_revision_id TEXT REFERENCES memory_revision(id),
                pending_key_digest TEXT,
                proposed_by_agent_profile_id TEXT NOT NULL REFERENCES agent_profile(id),
                source_camp_id TEXT NOT NULL,
                source_agent_run_id TEXT NOT NULL,
                source_execution_epoch INTEGER NOT NULL CHECK(source_execution_epoch >= 1),
                accepted_memory_id TEXT REFERENCES memory(id),
                accepted_revision_id TEXT REFERENCES memory_revision(id),
                version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
                proposed_at TEXT NOT NULL,
                resolved_at TEXT,
                candidate_cleared_at TEXT,
                CHECK (
                    (
                        candidate_body IS NOT NULL
                        AND length(candidate_body) > 0
                        AND candidate_body_utf8_bytes IS NOT NULL
                        AND candidate_cleared_at IS NULL
                        AND (
                            (
                                action = 'add'
                                AND target_memory_id IS NULL
                                AND base_revision_id IS NULL
                                AND candidate_scope_kind IS NOT NULL
                                AND candidate_kind IS NOT NULL
                            )
                            OR
                            (
                                action = 'revise'
                                AND target_memory_id IS NOT NULL
                                AND base_revision_id IS NOT NULL
                                AND candidate_scope_kind IS NULL
                                AND candidate_kind IS NULL
                            )
                        )
                    )
                    OR
                    (
                        candidate_body IS NULL
                        AND candidate_body_utf8_bytes IS NULL
                        AND candidate_scope_kind IS NULL
                        AND candidate_kind IS NULL
                        AND candidate_companion_agent_profile_id IS NULL
                        AND candidate_relationship_agent_low_id IS NULL
                        AND candidate_relationship_agent_high_id IS NULL
                        AND candidate_relationship_direction IS NULL
                        AND candidate_directed_actor_agent_profile_id IS NULL
                        AND target_memory_id IS NULL
                        AND base_revision_id IS NULL
                        AND candidate_cleared_at IS NOT NULL
                    )
                ),
                CHECK (
                    (status = 'pending' AND pending_key_digest IS NOT NULL
                        AND resolved_at IS NULL
                        AND accepted_memory_id IS NULL
                        AND accepted_revision_id IS NULL)
                    OR
                    (status = 'accepted' AND pending_key_digest IS NULL
                        AND resolved_at IS NOT NULL
                        AND accepted_memory_id IS NOT NULL
                        AND accepted_revision_id IS NOT NULL)
                    OR
                    (status = 'rejected' AND pending_key_digest IS NULL
                        AND resolved_at IS NOT NULL
                        AND accepted_memory_id IS NULL
                        AND accepted_revision_id IS NULL
                        AND candidate_body IS NULL)
                )
            );

            CREATE UNIQUE INDEX IF NOT EXISTS memory_proposal_pending_key_unique
                ON memory_proposal(pending_key_digest)
                WHERE status = 'pending';
            CREATE INDEX IF NOT EXISTS memory_proposal_status_time_idx
                ON memory_proposal(status, proposed_at, id);
            CREATE INDEX IF NOT EXISTS memory_proposal_source_run_idx
                ON memory_proposal(source_agent_run_id, proposed_at, id);
            CREATE INDEX IF NOT EXISTS memory_proposal_target_idx
                ON memory_proposal(target_memory_id, status, proposed_at, id);

            CREATE TABLE IF NOT EXISTS memory_supersession (
                predecessor_memory_id TEXT NOT NULL REFERENCES memory(id),
                successor_memory_id TEXT NOT NULL REFERENCES memory(id),
                created_at TEXT NOT NULL,
                PRIMARY KEY(predecessor_memory_id, successor_memory_id),
                CHECK(predecessor_memory_id <> successor_memory_id)
            );

            CREATE INDEX IF NOT EXISTS memory_supersession_successor_idx
                ON memory_supersession(successor_memory_id, predecessor_memory_id);

            CREATE TABLE IF NOT EXISTS memory_projection_observation (
                logical_key TEXT PRIMARY KEY,
                view_kind TEXT NOT NULL
                    CHECK(view_kind IN ('hearth', 'companion', 'relationship')),
                camp_id TEXT,
                perspective_agent_profile_id TEXT,
                path TEXT NOT NULL UNIQUE,
                formatter_version INTEGER NOT NULL CHECK(formatter_version >= 1),
                source_digest TEXT NOT NULL,
                published_digest TEXT,
                state TEXT NOT NULL
                    CHECK(state IN ('ready', 'empty', 'unavailable', 'write_failed')),
                last_error_code TEXT,
                last_observed_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS memory_projection_issue_idx
                ON memory_projection_observation(state, last_observed_at DESC);
            "#,
        )?;
        self.add_column_if_missing(
            "context_manifest",
            "memory_guide_json",
            "memory_guide_json TEXT NOT NULL DEFAULT '{\"schemaVersion\":1,\"formatterVersion\":1,\"guide\":\"\",\"locations\":[]}'",
        )?;
        self.add_column_if_missing(
            "context_manifest",
            "memory_guide_digest",
            "memory_guide_digest TEXT NOT NULL DEFAULT 'sha256:legacy-empty-memory-guide'",
        )?;

        let mut profiles = self
            .connection
            .prepare("SELECT id, default_capabilities_json FROM agent_profile")?
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        profiles.sort_by(|left, right| left.0.cmp(&right.0));
        for (profile_id, raw_capabilities) in profiles {
            let mut capabilities: Vec<String> = serde_json::from_str(&raw_capabilities)
                .with_context(|| {
                    format!("AgentProfile {profile_id} has invalid default capabilities")
                })?;
            if !capabilities
                .iter()
                .any(|capability| capability == "memory.propose_change")
            {
                capabilities.push("memory.propose_change".to_string());
                capabilities.sort();
                capabilities.dedup();
                self.connection.execute(
                    "UPDATE agent_profile SET default_capabilities_json = ?2 WHERE id = ?1",
                    params![profile_id, serde_json::to_string(&capabilities)?],
                )?;
            }
        }
        self.connection.execute(
            "INSERT INTO schema_migration(version, applied_at) VALUES (21, datetime('now'))",
            [],
        )?;
        Ok(())
    }

    fn migrate_context_v22(&mut self) -> Result<()> {
        self.connection
            .execute_batch("PRAGMA foreign_keys = OFF;")?;
        let migration_result = (|| -> Result<()> {
            let transaction = self
                .connection
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            let now = chrono::Utc::now().to_rfc3339();

            let conversation_columns = table_columns(&transaction, "conversation")?;
            if conversation_columns
                .iter()
                .any(|column| column == "native_delivered_camp_message_sequence")
                && !conversation_columns
                    .iter()
                    .any(|column| column == "native_read_through_camp_message_sequence")
            {
                transaction.execute_batch(
                    r#"
                    ALTER TABLE conversation
                    RENAME COLUMN native_delivered_camp_message_sequence
                    TO native_read_through_camp_message_sequence;
                    "#,
                )?;
            }

            let agent_run_columns = table_columns(&transaction, "agent_run")?;
            if !agent_run_columns
                .iter()
                .any(|column| column == "trigger_camp_message_id")
            {
                transaction.execute_batch(
                    r#"
                    ALTER TABLE agent_run ADD COLUMN trigger_camp_message_id TEXT
                        REFERENCES camp_message(id)
                        CHECK (
                            trigger_camp_message_id IS NULL
                            OR trigger_conversation_message_id IS NULL
                        )
                        CHECK (
                            input_ready_at IS NULL
                            OR trigger_camp_message_id IS NOT NULL
                            OR trigger_conversation_message_id IS NOT NULL
                        );
                    "#,
                )?;
            }

            // Trigger references must move before their materialized source rows disappear.
            transaction.execute(
                r#"
                UPDATE agent_run
                SET trigger_camp_message_id = (
                        SELECT conversation_message.source_camp_message_id
                        FROM conversation_message
                        WHERE conversation_message.id =
                            agent_run.trigger_conversation_message_id
                    ),
                    trigger_conversation_message_id = NULL
                WHERE trigger_conversation_message_id IS NOT NULL
                  AND EXISTS (
                      SELECT 1
                      FROM conversation_message
                      WHERE conversation_message.id =
                            agent_run.trigger_conversation_message_id
                        AND conversation_message.source_camp_message_id IS NOT NULL
                  )
                "#,
                [],
            )?;

            transaction.execute_batch(
                r#"
                CREATE TEMP TABLE v22_compaction_turn (
                    camp_turn_id TEXT PRIMARY KEY
                );

                INSERT INTO v22_compaction_turn(camp_turn_id)
                SELECT DISTINCT camp_turn_id
                FROM agent_run
                WHERE status = 'waiting'
                  AND wait_reason = 'context_compaction';
                "#,
            )?;
            transaction.execute(
                r#"
                UPDATE agent_run
                SET status = 'cancelled',
                    ended_at = ?1,
                    last_error_code = 'superseded_by_v012_migration',
                    wait_reason = NULL,
                    wait_deadline_at = NULL,
                    runtime_recovery_required = 0,
                    execution_lease_owner = NULL,
                    execution_lease_expires_at = NULL,
                    version = version + 1,
                    updated_at = ?1
                WHERE status = 'waiting'
                  AND wait_reason = 'context_compaction'
                "#,
                [&now],
            )?;
            transaction.execute(
                r#"
                UPDATE camp_turn
                SET status = CASE
                        WHEN EXISTS (
                            SELECT 1 FROM agent_run
                            WHERE agent_run.camp_turn_id = camp_turn.id
                              AND agent_run.status IN ('queued', 'running')
                        ) THEN 'running'
                        WHEN EXISTS (
                            SELECT 1 FROM agent_run
                            WHERE agent_run.camp_turn_id = camp_turn.id
                              AND agent_run.status = 'waiting'
                        ) THEN 'waiting'
                        WHEN cancel_requested_at IS NOT NULL THEN 'cancelled'
                        WHEN EXISTS (
                            SELECT 1 FROM agent_run
                            WHERE agent_run.camp_turn_id = camp_turn.id
                              AND agent_run.completion_role = 'required'
                              AND agent_run.status IN ('failed', 'cancelled')
                        ) THEN 'failed'
                        ELSE 'completed'
                    END,
                    ended_at = CASE
                        WHEN EXISTS (
                            SELECT 1 FROM agent_run
                            WHERE agent_run.camp_turn_id = camp_turn.id
                              AND agent_run.status IN ('queued', 'running', 'waiting')
                        ) THEN NULL
                        ELSE ?1
                    END,
                    version = version + 1,
                    updated_at = ?1
                WHERE id IN (SELECT camp_turn_id FROM v22_compaction_turn)
                  AND status IN ('running', 'waiting')
                "#,
                [&now],
            )?;

            // Public materializations have no independent attachment ownership. Clear the
            // legacy final pointer, then remove the duplicate rows before their schema paths.
            transaction.execute(
                r#"
                UPDATE agent_run
                SET final_conversation_message_id = NULL
                WHERE final_conversation_message_id IN (
                    SELECT id FROM conversation_message
                    WHERE source_camp_message_id IS NOT NULL
                )
                "#,
                [],
            )?;
            transaction.execute(
                r#"
                DELETE FROM message_attachment
                WHERE conversation_message_id IN (
                    SELECT id FROM conversation_message
                    WHERE source_camp_message_id IS NOT NULL
                )
                "#,
                [],
            )?;
            transaction.execute(
                "DELETE FROM conversation_message WHERE source_camp_message_id IS NOT NULL",
                [],
            )?;

            transaction.execute_batch(
                r#"
                DROP INDEX IF EXISTS context_compaction_pending_idx;
                DROP INDEX IF EXISTS context_compaction_active_range_unique;
                DROP TABLE IF EXISTS context_compaction_attempt;
                DROP INDEX IF EXISTS context_summary_conversation_range_idx;
                DROP TABLE IF EXISTS context_summary;

                ALTER TABLE context_manifest DROP COLUMN context_summary_ids_json;
                ALTER TABLE context_manifest ADD COLUMN
                    camp_summary_ids_json TEXT NOT NULL DEFAULT '[]';
                ALTER TABLE context_manifest ADD COLUMN
                    coverage_baseline_sequence INTEGER
                    CHECK (
                        coverage_baseline_sequence IS NULL
                        OR coverage_baseline_sequence >= 1
                    );
                "#,
            )?;

            let conversation_columns = table_columns(&transaction, "conversation")?;
            if conversation_columns
                .iter()
                .any(|column| column == "last_seen_camp_message_sequence")
            {
                transaction.execute_batch(
                    "ALTER TABLE conversation DROP COLUMN last_seen_camp_message_sequence;",
                )?;
            }

            let camp_message_columns = table_columns(&transaction, "camp_message")?;
            if !camp_message_columns
                .iter()
                .any(|column| column == "content_digest")
            {
                transaction.execute_batch(
                    r#"
                    ALTER TABLE camp_message ADD COLUMN content_digest TEXT
                        NOT NULL DEFAULT 'sha256:legacy-uncomputed'
                        CHECK(length(content_digest) > 0);
                    "#,
                )?;
            }
            let messages = {
                let mut statement =
                    transaction.prepare("SELECT id, body FROM camp_message ORDER BY id")?;
                statement
                    .query_map([], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?
            };
            for (message_id, body) in messages {
                let digest = camp_message_content_digest(&body);
                transaction.execute(
                    "UPDATE camp_message SET content_digest = ?2 WHERE id = ?1",
                    params![message_id, digest],
                )?;
            }

            transaction.execute_batch(
                r#"
                CREATE TABLE context_index_meta (
                    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
                    index_version INTEGER NOT NULL CHECK(index_version >= 1),
                    rebuilt_at TEXT NOT NULL
                );

                INSERT INTO context_index_meta(singleton, index_version, rebuilt_at)
                VALUES (1, 1, datetime('now'));

                CREATE TABLE camp_message_reference (
                    camp_message_id TEXT NOT NULL
                        REFERENCES camp_message(id) ON DELETE CASCADE,
                    kind TEXT NOT NULL
                        CHECK(kind IN ('adr', 'pr', 'issue', 'task')),
                    value TEXT NOT NULL,
                    PRIMARY KEY(camp_message_id, kind, value)
                );

                CREATE INDEX camp_message_reference_value_idx
                    ON camp_message_reference(kind, value, camp_message_id);

                CREATE TABLE camp_message_mention (
                    camp_message_id TEXT NOT NULL
                        REFERENCES camp_message(id) ON DELETE CASCADE,
                    agent_profile_id TEXT NOT NULL REFERENCES agent_profile(id),
                    PRIMARY KEY(camp_message_id, agent_profile_id)
                );

                CREATE INDEX camp_message_mention_agent_idx
                    ON camp_message_mention(agent_profile_id, camp_message_id);

                CREATE TABLE camp_summary (
                    id TEXT PRIMARY KEY,
                    camp_id TEXT NOT NULL REFERENCES camp(id) ON DELETE CASCADE,
                    level TEXT NOT NULL CHECK(level IN ('segment', 'epoch')),
                    from_sequence INTEGER NOT NULL CHECK(from_sequence >= 1),
                    through_sequence INTEGER NOT NULL,
                    source_digest TEXT NOT NULL,
                    input_truncated INTEGER NOT NULL DEFAULT 0
                        CHECK(input_truncated IN (0, 1)),
                    source_summary_ids_json TEXT NOT NULL DEFAULT '[]',
                    body TEXT NOT NULL CHECK(
                        length(body) > 0
                        AND (
                            (level = 'segment' AND length(body) <= 2000)
                            OR
                            (level = 'epoch' AND length(body) <= 4000)
                        )
                    ),
                    generator_adapter_kind TEXT NOT NULL,
                    generator_model_json TEXT NOT NULL,
                    generator_version TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    CHECK(through_sequence >= from_sequence),
                    UNIQUE(camp_id, level, from_sequence),
                    UNIQUE(camp_id, level, through_sequence)
                );

                CREATE INDEX camp_summary_camp_range_idx
                    ON camp_summary(camp_id, level, from_sequence, through_sequence);

                CREATE TABLE camp_summary_frontier (
                    camp_id TEXT NOT NULL REFERENCES camp(id) ON DELETE CASCADE,
                    level TEXT NOT NULL CHECK(level IN ('segment', 'epoch')),
                    next_from INTEGER NOT NULL CHECK(next_from >= 1),
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY(camp_id, level)
                );

                CREATE TABLE context_compaction_attempt (
                    id TEXT PRIMARY KEY,
                    camp_id TEXT NOT NULL REFERENCES camp(id) ON DELETE CASCADE,
                    level TEXT NOT NULL CHECK(level IN ('segment', 'epoch')),
                    from_sequence INTEGER NOT NULL CHECK(from_sequence >= 1),
                    through_sequence INTEGER NOT NULL,
                    source_digest TEXT NOT NULL,
                    input_truncated INTEGER NOT NULL DEFAULT 0
                        CHECK(input_truncated IN (0, 1)),
                    source_summary_ids_json TEXT NOT NULL DEFAULT '[]',
                    adapter_kind TEXT NOT NULL,
                    model_json TEXT NOT NULL,
                    runtime_json TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(
                        status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')
                    ),
                    generated_summary_id TEXT REFERENCES camp_summary(id),
                    retry_count INTEGER NOT NULL DEFAULT 0
                        CHECK(retry_count >= 0 AND retry_count <= 3),
                    lease_owner TEXT,
                    lease_expires_at TEXT,
                    error_code TEXT,
                    error_detail TEXT,
                    created_at TEXT NOT NULL,
                    started_at TEXT,
                    ended_at TEXT,
                    updated_at TEXT NOT NULL,
                    CHECK(through_sequence >= from_sequence),
                    CHECK(
                        (lease_owner IS NULL AND lease_expires_at IS NULL)
                        OR
                        (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
                    ),
                    CHECK(
                        (status = 'succeeded' AND generated_summary_id IS NOT NULL
                            AND ended_at IS NOT NULL AND error_code IS NULL
                            AND lease_owner IS NULL AND lease_expires_at IS NULL)
                        OR
                        (status IN ('failed', 'cancelled')
                            AND generated_summary_id IS NULL
                            AND ended_at IS NOT NULL
                            AND lease_owner IS NULL AND lease_expires_at IS NULL)
                        OR
                        (status IN ('queued', 'running')
                            AND generated_summary_id IS NULL
                            AND ended_at IS NULL)
                    )
                );

                CREATE INDEX context_compaction_pending_idx
                    ON context_compaction_attempt(status, created_at)
                    WHERE status IN ('queued', 'running');

                CREATE UNIQUE INDEX context_compaction_active_range_unique
                    ON context_compaction_attempt(camp_id, level, from_sequence)
                    WHERE status IN ('queued', 'running');

                CREATE TABLE context_compaction_waiter (
                    attempt_id TEXT NOT NULL
                        REFERENCES context_compaction_attempt(id) ON DELETE CASCADE,
                    agent_run_id TEXT NOT NULL UNIQUE REFERENCES agent_run(id),
                    created_at TEXT NOT NULL,
                    PRIMARY KEY(attempt_id, agent_run_id)
                );

                CREATE TABLE context_summary_config (
                    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
                    adapter_installation_id TEXT
                        REFERENCES adapter_installation(id),
                    model_json TEXT,
                    version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
                    updated_at TEXT NOT NULL,
                    CHECK(
                        (adapter_installation_id IS NULL AND model_json IS NULL)
                        OR
                        (adapter_installation_id IS NOT NULL AND model_json IS NOT NULL)
                    )
                );

                CREATE VIRTUAL TABLE camp_message_fts USING fts5(
                    body,
                    content='camp_message',
                    content_rowid='rowid',
                    tokenize='trigram'
                );

                CREATE VIRTUAL TABLE camp_summary_fts USING fts5(
                    body,
                    content='camp_summary',
                    content_rowid='rowid',
                    tokenize='trigram'
                );

                CREATE TRIGGER camp_message_fts_insert
                AFTER INSERT ON camp_message
                WHEN NEW.tombstoned_at IS NULL
                BEGIN
                    INSERT INTO camp_message_fts(rowid, body)
                    VALUES (NEW.rowid, NEW.body);
                END;

                CREATE TRIGGER camp_message_fts_delete
                AFTER DELETE ON camp_message
                WHEN OLD.tombstoned_at IS NULL
                BEGIN
                    INSERT INTO camp_message_fts(camp_message_fts, rowid, body)
                    VALUES ('delete', OLD.rowid, OLD.body);
                END;

                CREATE TRIGGER camp_message_fts_update
                AFTER UPDATE OF body, tombstoned_at ON camp_message
                BEGIN
                    INSERT INTO camp_message_fts(camp_message_fts, rowid, body)
                    SELECT 'delete', OLD.rowid, OLD.body
                    WHERE OLD.tombstoned_at IS NULL;
                    INSERT INTO camp_message_fts(rowid, body)
                    SELECT NEW.rowid, NEW.body
                    WHERE NEW.tombstoned_at IS NULL;
                END;

                CREATE TRIGGER camp_summary_fts_insert
                AFTER INSERT ON camp_summary
                BEGIN
                    INSERT INTO camp_summary_fts(rowid, body)
                    VALUES (NEW.rowid, NEW.body);
                END;

                CREATE TRIGGER camp_summary_fts_delete
                AFTER DELETE ON camp_summary
                BEGIN
                    INSERT INTO camp_summary_fts(camp_summary_fts, rowid, body)
                    VALUES ('delete', OLD.rowid, OLD.body);
                END;

                CREATE TRIGGER camp_summary_immutable
                BEFORE UPDATE ON camp_summary
                BEGIN
                    SELECT RAISE(ABORT, 'camp_summary rows are immutable');
                END;

                INSERT INTO camp_message_fts(rowid, body)
                SELECT rowid, body
                FROM camp_message
                WHERE tombstoned_at IS NULL;

                INSERT OR IGNORE INTO camp_message_mention(
                    camp_message_id, agent_profile_id
                )
                SELECT camp_message.id, json_each.value
                FROM camp_message, json_each(
                    camp_message.addressed_agent_profile_ids_json
                )
                JOIN agent_profile ON agent_profile.id = json_each.value;

                INSERT INTO schema_migration(version, applied_at)
                VALUES (22, datetime('now'));

                DROP TABLE v22_compaction_turn;
                "#,
            )?;

            let reference_sources = {
                let mut statement =
                    transaction.prepare("SELECT id, camp_id, body FROM camp_message")?;
                statement
                    .query_map([], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?
            };
            for (message_id, camp_id, body) in reference_sources {
                for (kind, value) in extract_context_references(&transaction, &camp_id, &body)? {
                    transaction.execute(
                        r#"
                        INSERT OR IGNORE INTO camp_message_reference(
                            camp_message_id, kind, value
                        ) VALUES (?1, ?2, ?3)
                        "#,
                        params![message_id, kind, value],
                    )?;
                }
            }

            transaction.commit()?;
            Ok(())
        })();
        let foreign_keys_result = self.connection.execute_batch("PRAGMA foreign_keys = ON;");
        migration_result?;
        foreign_keys_result?;
        if let Some((table, row_id)) = self
            .connection
            .query_row("PRAGMA foreign_key_check", [], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .optional()?
        {
            anyhow::bail!("v22 migration left a foreign-key violation in {table} row {row_id}");
        }
        Ok(())
    }

    fn migrate_lightweight_task_v17(&mut self) -> Result<()> {
        self.connection
            .execute_batch("PRAGMA foreign_keys = OFF;")?;
        let migration_result = (|| -> Result<()> {
            let transaction = self
                .connection
                .transaction_with_behavior(TransactionBehavior::Immediate)?;

            // v0.06 is an intentional collaboration protocol reset. Agent profiles,
            // their ordering, Adapter installations and user runtime preferences are
            // retained; every Camp aggregate is discarded before the single Task
            // schema is rebuilt.
            for table in [
                "context_compaction_waiter",
                "context_compaction_attempt",
                "camp_summary_frontier",
                "camp_summary",
                "context_summary",
            ] {
                let exists = transaction.query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
                    [table],
                    |row| row.get::<_, bool>(0),
                )?;
                if exists {
                    transaction.execute(&format!("DELETE FROM {table}"), [])?;
                }
            }
            transaction.execute_batch(
                r#"
                DELETE FROM runtime_delivery_checkpoint;
                DELETE FROM approval;
                DELETE FROM action_attempt;
                DELETE FROM action_execution;
                DELETE FROM runtime_input_delivery;
                DELETE FROM context_manifest;
                DELETE FROM message_attachment;
                DELETE FROM repository_commit_evidence;
                DELETE FROM inbox_message;
                DELETE FROM conversation_message;
                DELETE FROM camp_message;
                DELETE FROM agent_run;
                DELETE FROM camp_turn;
                DELETE FROM task_evidence_binding;
                DELETE FROM task_dependency;
                DELETE FROM turn;
                DELETE FROM runtime_session;
                DELETE FROM artifact;
                DELETE FROM task;
                DELETE FROM camp_view_state;
                DELETE FROM conversation;
                DELETE FROM camp_member;
                DELETE FROM camp;
                DELETE FROM project;
                DELETE FROM managed_blob;

                DELETE FROM event_log
                WHERE camp_id IS NOT NULL
                   OR task_id IS NOT NULL
                   OR entity_type IN (
                       'camp', 'camp_member', 'camp_message', 'conversation',
                       'conversation_message', 'camp_turn', 'agent_run',
                       'inbox_message', 'task', 'approval', 'action_execution'
                   );

                DROP TABLE task_evidence_binding;
                DROP TABLE task_dependency;
                DROP INDEX IF EXISTS task_camp_dedup_unique;
                DROP INDEX IF EXISTS task_camp_idx;
                DROP INDEX IF EXISTS task_project_idx;
                DROP TABLE task;

                CREATE TABLE task (
                    id TEXT PRIMARY KEY,
                    camp_id TEXT NOT NULL REFERENCES camp(id),
                    title TEXT NOT NULL CHECK(length(trim(title)) > 0),
                    description TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL
                        CHECK(status IN ('pending', 'in_progress', 'completed', 'cancelled')),
                    assignee_agent_id TEXT REFERENCES agent_profile(id),
                    created_by_type TEXT NOT NULL CHECK(created_by_type IN ('user', 'agent')),
                    created_by_id TEXT NOT NULL,
                    source_agent_run_id TEXT REFERENCES agent_run(id),
                    version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    closed_at TEXT,
                    CHECK (
                        (created_by_type = 'agent' AND source_agent_run_id IS NOT NULL)
                        OR
                        (created_by_type = 'user' AND source_agent_run_id IS NULL)
                    ),
                    CHECK (
                        (status IN ('completed', 'cancelled') AND closed_at IS NOT NULL)
                        OR
                        (status IN ('pending', 'in_progress') AND closed_at IS NULL)
                    )
                );

                CREATE INDEX task_camp_status_created_idx
                    ON task(camp_id, status, created_at, id);
                CREATE INDEX task_camp_assignee_status_idx
                    ON task(camp_id, assignee_agent_id, status, created_at, id);
                "#,
            )?;

            let profiles = {
                let mut statement = transaction.prepare(
                    "SELECT id, default_capabilities_json FROM agent_profile ORDER BY id",
                )?;
                statement
                    .query_map([], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?
            };
            for (profile_id, raw_capabilities) in profiles {
                let mut capabilities: Vec<String> = serde_json::from_str(&raw_capabilities)
                    .with_context(|| {
                        format!("AgentProfile {profile_id} has invalid capabilities")
                    })?;
                capabilities.retain(|capability| {
                    !matches!(
                        capability.as_str(),
                        "task.complete" | "task.cancel" | "task.dependency.manage"
                    )
                });
                for capability in ["task.create", "task.update"] {
                    if !capabilities.iter().any(|candidate| candidate == capability) {
                        capabilities.push(capability.to_string());
                    }
                }
                transaction.execute(
                    r#"
                    UPDATE agent_profile
                    SET default_capabilities_json = ?2
                    WHERE id = ?1
                    "#,
                    params![profile_id, serde_json::to_string(&capabilities)?],
                )?;
            }

            transaction.execute(
                "INSERT INTO schema_migration(version, applied_at) VALUES (17, datetime('now'))",
                [],
            )?;
            transaction.commit()?;
            Ok(())
        })();
        self.connection.execute_batch("PRAGMA foreign_keys = ON;")?;
        migration_result?;
        if let Some((table, row_id)) = self
            .connection
            .query_row("PRAGMA foreign_key_check", [], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .optional()?
        {
            anyhow::bail!("v17 migration left a foreign-key violation in {table} row {row_id}");
        }
        Ok(())
    }

    fn migrate_runtime_adapter_catalog_v16(&mut self) -> Result<()> {
        self.connection
            .execute_batch("PRAGMA foreign_keys = OFF;")?;
        let migration_result = (|| -> Result<()> {
            let transaction = self
                .connection
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            transaction.execute_batch(
                r#"
                CREATE TABLE adapter_installation_v16 (
                    id TEXT PRIMARY KEY,
                    adapter_kind TEXT NOT NULL CHECK(adapter_kind IN (
                        'codex-cli',
                        'opencode-cli',
                        'copilot-cli',
                        'claude-code-cli',
                        'antigravity-app'
                    )),
                    executable_path TEXT NOT NULL,
                    source TEXT NOT NULL CHECK(source IN ('discovered', 'custom')),
                    auth_scope TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    version INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(adapter_kind, executable_path, auth_scope)
                );

                INSERT INTO adapter_installation_v16(
                    id, adapter_kind, executable_path, source, auth_scope,
                    enabled, version, created_at, updated_at
                )
                SELECT
                    id,
                    CASE adapter_kind
                        WHEN 'agy-cli' THEN 'antigravity-app'
                        ELSE adapter_kind
                    END,
                    executable_path, source, auth_scope,
                    enabled, version, created_at, updated_at
                FROM adapter_installation
                WHERE adapter_kind IN (
                    'codex-cli',
                    'opencode-cli',
                    'copilot-cli',
                    'agy-cli',
                    'claude-code-cli',
                    'antigravity-app'
                );

                DROP TABLE adapter_installation;
                ALTER TABLE adapter_installation_v16 RENAME TO adapter_installation;
                CREATE INDEX adapter_installation_kind_idx
                    ON adapter_installation(adapter_kind, enabled, created_at);

                UPDATE agent_run
                SET runtime_adapter_kind = 'antigravity-app'
                WHERE runtime_adapter_kind = 'agy-cli';

                UPDATE agent_profile
                SET default_permission_config_json =
                        replace(default_permission_config_json, '"agy-cli"', '"antigravity-app"'),
                    default_model_selection_json =
                        replace(
                            default_model_selection_json,
                            'agy://runtime-default',
                            'antigravity://runtime-default'
                        )
                WHERE default_permission_config_json LIKE '%agy-cli%'
                   OR default_model_selection_json LIKE '%agy://runtime-default%';

                UPDATE agent_run
                SET runtime_permission_config_json =
                        replace(runtime_permission_config_json, '"agy-cli"', '"antigravity-app"'),
                    runtime_model_selection_json =
                        replace(
                            runtime_model_selection_json,
                            'agy://runtime-default',
                            'antigravity://runtime-default'
                        ),
                    effective_config_json =
                        replace(
                            replace(
                                effective_config_json,
                                '"agy-cli"',
                                '"antigravity-app"'
                            ),
                            'agy://runtime-default',
                            'antigravity://runtime-default'
                        )
                WHERE runtime_permission_config_json LIKE '%agy-cli%'
                   OR runtime_model_selection_json LIKE '%agy://runtime-default%'
                   OR effective_config_json LIKE '%agy-cli%'
                   OR effective_config_json LIKE '%agy://runtime-default%';

                UPDATE adapter_capability_snapshot
                SET model_catalog_json = replace(
                    model_catalog_json,
                    'agy://runtime-default',
                    'antigravity://runtime-default'
                ),
                    protocols_json = replace(
                        protocols_json,
                        'agy-cli-v1',
                        'antigravity-app-cli-v1'
                    )
                WHERE model_catalog_json LIKE '%agy://runtime-default%'
                   OR protocols_json LIKE '%agy-cli-v1%';
                "#,
            )?;
            transaction.commit()?;
            Ok(())
        })();
        let foreign_keys_result = self.connection.execute_batch("PRAGMA foreign_keys = ON;");
        migration_result?;
        foreign_keys_result?;
        let violation = self
            .connection
            .query_row("PRAGMA foreign_key_check", [], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .optional()?;
        if let Some((table, row_id)) = violation {
            anyhow::bail!("v16 migration left a foreign-key violation in {table} row {row_id}");
        }
        Ok(())
    }

    fn migrate_context_and_a2a_schema(&mut self) -> Result<()> {
        self.add_column_if_missing(
            "conversation",
            "native_binding_id",
            "native_binding_id TEXT",
        )?;
        self.add_column_if_missing(
            "conversation",
            "native_binding_generation",
            "native_binding_generation INTEGER NOT NULL DEFAULT 0 CHECK(native_binding_generation >= 0)",
        )?;
        self.add_column_if_missing(
            "conversation",
            "native_binding_secret_digest",
            "native_binding_secret_digest TEXT",
        )?;
        self.add_column_if_missing(
            "conversation",
            "native_read_through_camp_message_sequence",
            "native_read_through_camp_message_sequence INTEGER NOT NULL DEFAULT 0 CHECK(native_read_through_camp_message_sequence >= 0)",
        )?;
        self.add_column_if_missing(
            "conversation",
            "native_charter_digest",
            "native_charter_digest TEXT",
        )?;
        self.add_column_if_missing(
            "conversation",
            "native_member_state_digest",
            "native_member_state_digest TEXT",
        )?;
        self.add_column_if_missing(
            "agent_run",
            "invocation_kind",
            "invocation_kind TEXT NOT NULL DEFAULT 'direct' CHECK(invocation_kind IN ('direct', 'a2a'))",
        )?;
        self.add_column_if_missing(
            "agent_run",
            "a2a_parent_agent_run_id",
            "a2a_parent_agent_run_id TEXT REFERENCES agent_run(id)",
        )?;
        self.add_column_if_missing(
            "agent_run",
            "a2a_root_agent_run_id",
            "a2a_root_agent_run_id TEXT REFERENCES agent_run(id)",
        )?;
        self.add_column_if_missing(
            "agent_run",
            "a2a_depth",
            "a2a_depth INTEGER NOT NULL DEFAULT 0 CHECK(a2a_depth >= 0)",
        )?;

        let now = chrono::Utc::now().to_rfc3339();
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute(
            r#"
            INSERT INTO migration_diagnostic(
                migration_version, code, legacy_entity_type,
                legacy_entity_id, detail, created_at
            )
            SELECT 14, 'duplicate_inbox_target_run_detached', 'inbox_message',
                   duplicate.id,
                   'Duplicate target AgentRun relation was detached during v14 migration',
                   ?1
            FROM inbox_message AS duplicate
            WHERE duplicate.target_agent_run_id IS NOT NULL
              AND duplicate.id <> (
                  SELECT canonical.id
                  FROM inbox_message AS canonical
                  WHERE canonical.target_agent_run_id = duplicate.target_agent_run_id
                  ORDER BY canonical.created_at, canonical.id
                  LIMIT 1
              )
            "#,
            [&now],
        )?;
        transaction.execute(
            r#"
            UPDATE inbox_message
            SET target_agent_run_id = NULL,
                failed_at = CASE
                    WHEN delivered_at IS NULL THEN COALESCE(failed_at, ?1)
                    ELSE failed_at
                END,
                last_error = CASE
                    WHEN delivered_at IS NULL
                        THEN COALESCE(last_error, 'duplicate_target_agent_run_detached')
                    ELSE last_error
                END,
                lease_owner = NULL,
                lease_expires_at = NULL,
                updated_at = ?1
            WHERE target_agent_run_id IS NOT NULL
              AND id <> (
                  SELECT canonical.id
                  FROM inbox_message AS canonical
                  WHERE canonical.target_agent_run_id = inbox_message.target_agent_run_id
                  ORDER BY canonical.created_at, canonical.id
                  LIMIT 1
              )
            "#,
            [&now],
        )?;
        transaction.execute_batch(
            r#"
            CREATE UNIQUE INDEX IF NOT EXISTS conversation_native_binding_id_unique
                ON conversation(native_binding_id)
                WHERE native_binding_id IS NOT NULL;

            CREATE INDEX IF NOT EXISTS agent_run_a2a_turn_idx
                ON agent_run(camp_turn_id, invocation_kind, created_at);
            CREATE INDEX IF NOT EXISTS agent_run_a2a_parent_idx
                ON agent_run(a2a_parent_agent_run_id)
                WHERE a2a_parent_agent_run_id IS NOT NULL;
            CREATE UNIQUE INDEX IF NOT EXISTS inbox_target_agent_run_unique
                ON inbox_message(target_agent_run_id)
                WHERE target_agent_run_id IS NOT NULL;

            CREATE TABLE context_summary (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL REFERENCES conversation(id),
                summary_kind TEXT NOT NULL CHECK(summary_kind IN ('bootstrap', 'unread')),
                from_camp_message_sequence INTEGER NOT NULL
                    CHECK(from_camp_message_sequence >= 1),
                through_camp_message_sequence INTEGER NOT NULL,
                source_digest TEXT NOT NULL,
                visibility_scope_digest TEXT NOT NULL,
                body TEXT NOT NULL CHECK(length(body) > 0),
                generator_adapter_kind TEXT NOT NULL,
                generator_model_json TEXT NOT NULL,
                generator_version TEXT NOT NULL,
                created_at TEXT NOT NULL,
                CHECK(through_camp_message_sequence >= from_camp_message_sequence),
                UNIQUE(
                    conversation_id, summary_kind,
                    from_camp_message_sequence, through_camp_message_sequence,
                    source_digest, visibility_scope_digest
                )
            );

            CREATE INDEX context_summary_conversation_range_idx
                ON context_summary(
                    conversation_id,
                    from_camp_message_sequence,
                    through_camp_message_sequence
                );

            CREATE TABLE context_manifest (
                id TEXT PRIMARY KEY,
                agent_run_id TEXT NOT NULL UNIQUE REFERENCES agent_run(id),
                native_binding_generation INTEGER NOT NULL
                    CHECK(native_binding_generation >= 1),
                camp_message_boundary_sequence INTEGER NOT NULL
                    CHECK(camp_message_boundary_sequence >= 0),
                conversation_message_boundary_sequence INTEGER NOT NULL
                    CHECK(conversation_message_boundary_sequence >= 0),
                raw_message_refs_json TEXT NOT NULL DEFAULT '[]',
                context_summary_ids_json TEXT NOT NULL DEFAULT '[]',
                attachment_metadata_json TEXT NOT NULL DEFAULT '[]',
                work_brief_json TEXT NOT NULL,
                work_brief_digest TEXT NOT NULL,
                task_context_json TEXT NOT NULL
                    DEFAULT '{"schemaVersion":1,"tasks":[],"truncated":false,"omittedCount":0}',
                task_context_digest TEXT NOT NULL
                    DEFAULT 'sha256:legacy-empty-task-context',
                control_signals_json TEXT NOT NULL,
                charter_digest TEXT NOT NULL,
                member_state_digest TEXT NOT NULL,
                formatter_version INTEGER NOT NULL CHECK(formatter_version >= 1),
                rendered_payload_blob_id TEXT NOT NULL REFERENCES managed_blob(id),
                rendered_payload_digest TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE INDEX context_manifest_blob_idx
                ON context_manifest(rendered_payload_blob_id);

            CREATE TABLE context_compaction_attempt (
                id TEXT PRIMARY KEY,
                agent_run_id TEXT NOT NULL REFERENCES agent_run(id),
                conversation_id TEXT NOT NULL REFERENCES conversation(id),
                summary_kind TEXT NOT NULL CHECK(summary_kind IN ('bootstrap', 'unread')),
                from_camp_message_sequence INTEGER NOT NULL
                    CHECK(from_camp_message_sequence >= 1),
                through_camp_message_sequence INTEGER NOT NULL,
                source_digest TEXT NOT NULL,
                visibility_scope_digest TEXT NOT NULL,
                adapter_kind TEXT NOT NULL,
                model_json TEXT NOT NULL,
                status TEXT NOT NULL
                    CHECK(status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
                generated_summary_id TEXT REFERENCES context_summary(id),
                error_code TEXT,
                error_detail TEXT,
                created_at TEXT NOT NULL,
                started_at TEXT,
                ended_at TEXT,
                updated_at TEXT NOT NULL,
                CHECK(through_camp_message_sequence >= from_camp_message_sequence),
                CHECK(
                    (status = 'succeeded' AND generated_summary_id IS NOT NULL
                        AND ended_at IS NOT NULL AND error_code IS NULL)
                    OR
                    (status IN ('failed', 'cancelled') AND generated_summary_id IS NULL
                        AND ended_at IS NOT NULL)
                    OR
                    (status IN ('queued', 'running') AND generated_summary_id IS NULL
                        AND ended_at IS NULL)
                ),
                UNIQUE(
                    agent_run_id, summary_kind,
                    from_camp_message_sequence, through_camp_message_sequence,
                    source_digest, visibility_scope_digest
                )
            );

            CREATE INDEX context_compaction_pending_idx
                ON context_compaction_attempt(status, created_at)
                WHERE status IN ('queued', 'running');
            CREATE TABLE runtime_input_delivery (
                id TEXT PRIMARY KEY,
                agent_run_id TEXT NOT NULL REFERENCES agent_run(id),
                execution_epoch INTEGER NOT NULL CHECK(execution_epoch >= 1),
                context_manifest_id TEXT NOT NULL REFERENCES context_manifest(id),
                native_binding_id TEXT NOT NULL,
                native_binding_generation INTEGER NOT NULL
                    CHECK(native_binding_generation >= 1),
                boundary_camp_message_sequence INTEGER NOT NULL
                    CHECK(boundary_camp_message_sequence >= 0),
                request_digest TEXT NOT NULL,
                status TEXT NOT NULL
                    CHECK(status IN ('prepared', 'accepted', 'delivery_unknown', 'not_accepted')),
                native_input_id TEXT,
                prepared_at TEXT NOT NULL,
                accepted_at TEXT,
                resolved_at TEXT,
                last_error TEXT,
                updated_at TEXT NOT NULL,
                UNIQUE(agent_run_id, execution_epoch),
                CHECK(
                    (status = 'accepted' AND native_input_id IS NOT NULL
                        AND accepted_at IS NOT NULL)
                    OR status <> 'accepted'
                )
            );

            CREATE UNIQUE INDEX runtime_input_native_identity_unique
                ON runtime_input_delivery(native_binding_id, native_input_id)
                WHERE native_input_id IS NOT NULL;
            CREATE INDEX runtime_input_reconcile_idx
                ON runtime_input_delivery(status, updated_at)
                WHERE status = 'delivery_unknown';
            "#,
        )?;

        transaction.execute(
            r#"
            INSERT INTO migration_diagnostic(
                migration_version, code, legacy_entity_type,
                legacy_entity_id, detail, created_at
            )
            SELECT 14, 'agent_run_context_not_reproducible', 'agent_run', id,
                   'Non-terminal AgentRun predates ContextManifest and requires an explicit retry',
                   ?1
            FROM agent_run
            WHERE status IN ('queued', 'running', 'waiting')
            "#,
            [&now],
        )?;
        transaction.execute(
            r#"
            UPDATE agent_run
            SET status = 'failed', wait_reason = NULL,
                runtime_recovery_required = 0,
                execution_lease_owner = NULL,
                execution_lease_expires_at = NULL,
                last_error_code = 'context_manifest_migration_required',
                manual_retry_allowed = 1,
                ended_at = ?1, version = version + 1, updated_at = ?1
            WHERE status IN ('queued', 'running', 'waiting')
            "#,
            [&now],
        )?;
        transaction.execute(
            r#"
            UPDATE camp_turn
            SET status = 'waiting', ended_at = NULL,
                version = version + 1, updated_at = ?1
            WHERE status IN ('running', 'waiting')
              AND NOT EXISTS (
                  SELECT 1 FROM agent_run
                  WHERE agent_run.camp_turn_id = camp_turn.id
                    AND agent_run.status IN ('queued', 'running', 'waiting')
              )
              AND EXISTS (
                  SELECT 1 FROM agent_run
                  WHERE agent_run.camp_turn_id = camp_turn.id
                    AND agent_run.completion_role = 'required'
                    AND agent_run.status = 'failed'
                    AND agent_run.manual_retry_allowed = 1
                    AND agent_run.retry_declined_at IS NULL
              )
            "#,
            [&now],
        )?;
        transaction.execute(
            r#"
            UPDATE conversation
            SET native_adapter_installation_id = NULL,
                native_session_id = NULL,
                native_binding_compatibility_digest = NULL,
                native_binding_id = NULL,
                native_binding_generation = 0,
                native_binding_secret_digest = NULL,
                native_read_through_camp_message_sequence = 0,
                native_charter_digest = NULL,
                native_member_state_digest = NULL,
                version = version + 1,
                updated_at = ?1
            "#,
            [&now],
        )?;
        transaction.commit()?;
        Ok(())
    }

    fn remove_empty_compatibility_contexts(&mut self) -> Result<()> {
        let transaction = self.connection.transaction()?;
        transaction.execute_batch(
            r#"
            CREATE TEMP TABLE v13_obsolete_compatibility_camp(
                id TEXT PRIMARY KEY
            );

            INSERT INTO v13_obsolete_compatibility_camp(id)
            SELECT camp.id
            FROM camp
            JOIN project ON camp.id = 'camp-' || project.id
            WHERE NOT EXISTS (SELECT 1 FROM task WHERE task.camp_id = camp.id)
              AND NOT EXISTS (SELECT 1 FROM camp_message WHERE camp_message.camp_id = camp.id)
              AND NOT EXISTS (SELECT 1 FROM camp_turn WHERE camp_turn.camp_id = camp.id)
              AND NOT EXISTS (SELECT 1 FROM inbox_message WHERE inbox_message.camp_id = camp.id)
              AND NOT EXISTS (
                  SELECT 1
                  FROM conversation_message
                  JOIN conversation ON conversation.id = conversation_message.conversation_id
                  WHERE conversation.camp_id = camp.id
              )
              AND NOT EXISTS (SELECT 1 FROM event_log WHERE event_log.camp_id = camp.id);

            DELETE FROM camp_view_state
            WHERE camp_id IN (SELECT id FROM v13_obsolete_compatibility_camp);
            DELETE FROM legacy_import_map
            WHERE target_entity_type = 'camp'
              AND target_entity_id IN (SELECT id FROM v13_obsolete_compatibility_camp);
            DELETE FROM conversation
            WHERE camp_id IN (SELECT id FROM v13_obsolete_compatibility_camp);
            DELETE FROM camp_member
            WHERE camp_id IN (SELECT id FROM v13_obsolete_compatibility_camp);
            DELETE FROM camp
            WHERE id IN (SELECT id FROM v13_obsolete_compatibility_camp);

            DELETE FROM project
            WHERE NOT EXISTS (
                SELECT 1 FROM task WHERE task.project_id = project.id
            );

            DROP TABLE v13_obsolete_compatibility_camp;
            "#,
        )?;
        transaction.commit()?;
        Ok(())
    }

    fn schema_migration_applied(&self, version: i64) -> Result<bool> {
        let count: i64 = self.connection.query_row(
            "SELECT COUNT(*) FROM schema_migration WHERE version = ?1",
            [version],
            |row| row.get(0),
        )?;
        Ok(count == 1)
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
                runtime_recovery_required INTEGER NOT NULL DEFAULT 0,
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
        self.add_column_if_missing(
            "agent_run",
            "runtime_recovery_required",
            "runtime_recovery_required INTEGER NOT NULL DEFAULT 0",
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
                CASE kind WHEN 'git' THEN 'refs/rovai/camps/' || id ELSE NULL END,
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
                last_message_sequence,
                version, created_at, updated_at
            )
            SELECT
                'conversation-' || camp_member.camp_id || '-' || camp_member.agent_profile_id,
                camp_member.camp_id,
                camp_member.agent_profile_id,
                NULL, NULL, NULL, NULL, NULL, 0, 0, 1,
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
                source_agent_run_execution_epoch INTEGER NOT NULL DEFAULT 0,
                native_request_method TEXT,
                native_request_id_json TEXT,
                native_item_id TEXT,
                native_thread_id TEXT,
                native_turn_id TEXT,
                native_response_context_json TEXT,
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

        self.add_column_if_missing(
            "action_execution",
            "source_agent_run_execution_epoch",
            "source_agent_run_execution_epoch INTEGER NOT NULL DEFAULT 0",
        )?;
        self.add_column_if_missing(
            "action_execution",
            "native_request_method",
            "native_request_method TEXT",
        )?;
        self.add_column_if_missing(
            "action_execution",
            "native_request_id_json",
            "native_request_id_json TEXT",
        )?;
        self.add_column_if_missing("action_execution", "native_item_id", "native_item_id TEXT")?;
        self.add_column_if_missing(
            "action_execution",
            "native_thread_id",
            "native_thread_id TEXT",
        )?;
        self.add_column_if_missing("action_execution", "native_turn_id", "native_turn_id TEXT")?;
        self.add_column_if_missing(
            "action_execution",
            "native_response_context_json",
            "native_response_context_json TEXT",
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

    fn migrate_multi_runtime_schema(&mut self) -> Result<()> {
        self.connection.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS adapter_installation (
                id TEXT PRIMARY KEY,
                adapter_kind TEXT NOT NULL
                    CHECK(adapter_kind IN (
                        'codex-cli', 'opencode-cli', 'copilot-cli',
                        'claude-code-cli', 'antigravity-app'
                    )),
                executable_path TEXT NOT NULL,
                source TEXT NOT NULL CHECK(source IN ('discovered', 'custom')),
                auth_scope TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                version INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(adapter_kind, executable_path, auth_scope)
            );

            CREATE TABLE IF NOT EXISTS adapter_capability_snapshot (
                installation_id TEXT PRIMARY KEY
                    REFERENCES adapter_installation(id) ON DELETE CASCADE,
                reported_version TEXT,
                executable_fingerprint TEXT,
                authentication_status TEXT NOT NULL,
                probe_status TEXT NOT NULL,
                permission_schema_version INTEGER NOT NULL DEFAULT 1,
                capabilities_json TEXT NOT NULL DEFAULT '[]',
                protocols_json TEXT NOT NULL DEFAULT '[]',
                model_catalog_json TEXT NOT NULL DEFAULT '[]',
                permission_options_json TEXT NOT NULL DEFAULT '[]',
                observed_at TEXT,
                last_attempted_at TEXT NOT NULL,
                stale_at TEXT,
                last_error TEXT
            );

            CREATE INDEX IF NOT EXISTS adapter_installation_kind_idx
                ON adapter_installation(adapter_kind, enabled, created_at);
            "#,
        )?;

        self.add_column_if_missing("agent_profile", "handle", "handle TEXT")?;
        self.add_column_if_missing("agent_profile", "persona_label", "persona_label TEXT")?;
        self.add_column_if_missing("agent_profile", "role_description", "role_description TEXT")?;
        self.add_column_if_missing(
            "agent_profile",
            "default_runtime_installation_id",
            "default_runtime_installation_id TEXT REFERENCES adapter_installation(id)",
        )?;
        self.add_column_if_missing(
            "agent_profile",
            "default_model_selection_json",
            "default_model_selection_json TEXT",
        )?;
        self.add_column_if_missing(
            "agent_profile",
            "default_permission_config_json",
            "default_permission_config_json TEXT",
        )?;
        self.add_column_if_missing(
            "conversation",
            "native_adapter_installation_id",
            "native_adapter_installation_id TEXT REFERENCES adapter_installation(id)",
        )?;
        self.add_column_if_missing(
            "conversation",
            "native_binding_compatibility_digest",
            "native_binding_compatibility_digest TEXT",
        )?;
        self.add_column_if_missing(
            "agent_run",
            "runtime_adapter_kind",
            "runtime_adapter_kind TEXT",
        )?;
        self.add_column_if_missing(
            "agent_run",
            "runtime_installation_id",
            "runtime_installation_id TEXT REFERENCES adapter_installation(id)",
        )?;
        self.add_column_if_missing(
            "agent_run",
            "runtime_reported_version",
            "runtime_reported_version TEXT",
        )?;
        self.add_column_if_missing(
            "agent_run",
            "runtime_executable_fingerprint",
            "runtime_executable_fingerprint TEXT",
        )?;
        self.add_column_if_missing(
            "agent_run",
            "runtime_capabilities_json",
            "runtime_capabilities_json TEXT",
        )?;
        self.add_column_if_missing(
            "agent_run",
            "runtime_model_selection_json",
            "runtime_model_selection_json TEXT",
        )?;
        self.add_column_if_missing(
            "agent_run",
            "runtime_permission_config_json",
            "runtime_permission_config_json TEXT",
        )?;
        self.add_column_if_missing(
            "agent_run",
            "runtime_binding_compatibility_digest",
            "runtime_binding_compatibility_digest TEXT",
        )?;

        let now = chrono::Utc::now().to_rfc3339();
        let transaction = self.connection.transaction()?;
        transaction.execute_batch(
            r#"
            DROP INDEX IF EXISTS conversation_native_session_unique;
            CREATE UNIQUE INDEX IF NOT EXISTS conversation_native_binding_unique
                ON conversation(native_adapter_installation_id, native_session_id)
                WHERE native_adapter_installation_id IS NOT NULL
                  AND native_session_id IS NOT NULL;

            CREATE UNIQUE INDEX IF NOT EXISTS agent_profile_handle_unique
                ON agent_profile(handle)
                WHERE handle IS NOT NULL;

            UPDATE agent_profile
            SET handle = COALESCE(handle, slug),
                persona_label = COALESCE(persona_label, species),
                role_description = COALESCE(role_description, role_contract),
                instructions = CASE
                    WHEN instructions = '' THEN role_contract
                    ELSE instructions
                END,
                default_capabilities_json = CASE
                    WHEN default_capabilities_json <> '[]' THEN default_capabilities_json
                    ELSE CASE slug
                        WHEN 'luoke' THEN '["task.create","task.complete","task.cancel","task.dependency.manage","agent_run.create","agent_run.retry","agent_run.cancel","inbox.send"]'
                        WHEN 'muwa' THEN '["task.create","task.complete","task.cancel","agent_run.create","agent_run.retry","agent_run.cancel","inbox.send","workspace.bind","action.request"]'
                        WHEN 'mianzhi' THEN '["agent_run.create","inbox.send"]'
                        WHEN 'qilu' THEN '["agent_run.create","inbox.send"]'
                        ELSE default_capabilities_json
                    END
                END,
                default_runtime_installation_id = NULL,
                default_model_selection_json = NULL,
                default_permission_config_json = NULL,
                default_provider = NULL,
                default_model = NULL,
                runtime_enabled = 0;

            UPDATE conversation
            SET native_session_id = NULL,
                native_adapter_installation_id = NULL,
                native_binding_compatibility_digest = NULL;
            "#,
        )?;
        transaction.execute(
            r#"
            UPDATE agent_run
            SET status = 'failed', wait_reason = NULL,
                last_error_code = 'runtime_configuration_migration_required',
                manual_retry_allowed = 1,
                runtime_recovery_required = 0,
                execution_lease_owner = NULL,
                execution_lease_expires_at = NULL,
                ended_at = ?1, version = version + 1, updated_at = ?1
            WHERE status IN ('queued', 'running', 'waiting')
              AND runtime_installation_id IS NULL
            "#,
            [&now],
        )?;
        transaction.execute(
            r#"
            UPDATE camp_turn
            SET status = 'failed', ended_at = ?1,
                version = version + 1, updated_at = ?1
            WHERE status IN ('running', 'waiting')
              AND EXISTS (
                  SELECT 1 FROM agent_run
                  WHERE agent_run.camp_turn_id = camp_turn.id
                    AND agent_run.last_error_code = 'runtime_configuration_migration_required'
              )
              AND NOT EXISTS (
                  SELECT 1 FROM agent_run
                  WHERE agent_run.camp_turn_id = camp_turn.id
                    AND agent_run.status IN ('queued', 'running', 'waiting')
              )
            "#,
            [&now],
        )?;
        transaction.commit()?;
        Ok(())
    }

    fn migrate_frozen_runtime_execution_schema(&mut self) -> Result<()> {
        self.add_column_if_missing(
            "agent_run",
            "runtime_executable_path",
            "runtime_executable_path TEXT",
        )?;
        self.add_column_if_missing("agent_run", "runtime_auth_scope", "runtime_auth_scope TEXT")?;
        self.add_column_if_missing(
            "agent_run",
            "runtime_host_config_digest",
            "runtime_host_config_digest TEXT",
        )?;
        self.add_column_if_missing(
            "agent_run",
            "runtime_protocol_version",
            "runtime_protocol_version TEXT",
        )?;
        let now = chrono::Utc::now().to_rfc3339();
        let transaction = self.connection.transaction()?;
        transaction.execute(
            r#"
            UPDATE agent_run
            SET status = 'failed', wait_reason = NULL,
                last_error_code = 'runtime_configuration_migration_required',
                manual_retry_allowed = 1,
                runtime_recovery_required = 0,
                execution_lease_owner = NULL,
                execution_lease_expires_at = NULL,
                ended_at = ?1, version = version + 1, updated_at = ?1
            WHERE status IN ('queued', 'running', 'waiting')
              AND (
                  runtime_adapter_kind IS NULL
                  OR runtime_installation_id IS NULL
                  OR runtime_executable_path IS NULL
                  OR runtime_executable_fingerprint IS NULL
                  OR runtime_model_selection_json IS NULL
                  OR runtime_permission_config_json IS NULL
                  OR runtime_binding_compatibility_digest IS NULL
                  OR runtime_host_config_digest IS NULL
                  OR runtime_protocol_version IS NULL
              )
            "#,
            [&now],
        )?;
        transaction.execute(
            r#"
            UPDATE camp_turn
            SET status = 'failed', ended_at = ?1,
                version = version + 1, updated_at = ?1
            WHERE status IN ('running', 'waiting')
              AND EXISTS (
                  SELECT 1 FROM agent_run
                  WHERE agent_run.camp_turn_id = camp_turn.id
                    AND agent_run.last_error_code = 'runtime_configuration_migration_required'
              )
              AND NOT EXISTS (
                  SELECT 1 FROM agent_run
                  WHERE agent_run.camp_turn_id = camp_turn.id
                    AND agent_run.status IN ('queued', 'running', 'waiting')
              )
            "#,
            [&now],
        )?;
        transaction.commit()?;
        Ok(())
    }

    fn migrate_camp_navigation_schema(&mut self) -> Result<()> {
        self.add_column_if_missing(
            "agent_profile",
            "member_order",
            "member_order INTEGER NOT NULL DEFAULT 0",
        )?;

        self.connection
            .execute_batch("PRAGMA foreign_keys = OFF;")?;
        let migration_result = (|| -> Result<()> {
            let transaction = self
                .connection
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            transaction.execute_batch(
                r#"
                CREATE TABLE camp_v11 (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    project_path TEXT NOT NULL,

                    repository_scope_id TEXT,
                    repository_git_common_dir TEXT,
                    repository_object_format TEXT,
                    repository_internal_ref_namespace TEXT,
                    repository_bound_at TEXT,
                    repository_relocated_at TEXT,

                    default_lead_agent_id TEXT,
                    status TEXT NOT NULL DEFAULT 'active'
                        CHECK(status IN ('active', 'archived')),
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

                INSERT INTO camp_v11(
                    id, title, project_path,
                    repository_scope_id, repository_git_common_dir,
                    repository_object_format, repository_internal_ref_namespace,
                    repository_bound_at, repository_relocated_at,
                    default_lead_agent_id, status, last_message_sequence,
                    version, created_at, updated_at, archived_at
                )
                SELECT
                    camp.id,
                    COALESCE(
                        NULLIF((
                            SELECT camp_message.body
                            FROM camp_message
                            WHERE camp_message.camp_id = camp.id
                              AND camp_message.author_type = 'user'
                              AND camp_message.tombstoned_at IS NULL
                            ORDER BY camp_message.sequence
                            LIMIT 1
                        ), ''),
                        NULLIF((
                            SELECT task.title
                            FROM task
                            WHERE task.camp_id = camp.id
                            ORDER BY task.created_at, task.id
                            LIMIT 1
                        ), ''),
                        '新对话'
                    ),
                    camp.project_path,
                    camp.repository_scope_id,
                    camp.repository_git_common_dir,
                    camp.repository_object_format,
                    camp.repository_internal_ref_namespace,
                    camp.repository_bound_at,
                    camp.repository_relocated_at,
                    camp.default_lead_agent_id,
                    camp.status,
                    camp.last_message_sequence,
                    camp.version,
                    camp.created_at,
                    camp.updated_at,
                    camp.archived_at
                FROM camp;

                DROP TABLE camp;
                ALTER TABLE camp_v11 RENAME TO camp;

                CREATE INDEX camp_repository_scope_idx
                    ON camp(repository_scope_id)
                    WHERE repository_scope_id IS NOT NULL;
                CREATE INDEX camp_repository_location_idx
                    ON camp(repository_git_common_dir, repository_object_format)
                    WHERE repository_git_common_dir IS NOT NULL;
                CREATE UNIQUE INDEX camp_internal_ref_namespace_unique
                    ON camp(repository_internal_ref_namespace)
                    WHERE repository_internal_ref_namespace IS NOT NULL;

                UPDATE camp
                SET repository_scope_id = (
                    SELECT canonical.repository_scope_id
                    FROM camp AS canonical
                    WHERE canonical.repository_git_common_dir = camp.repository_git_common_dir
                      AND canonical.repository_object_format = camp.repository_object_format
                      AND canonical.repository_scope_id IS NOT NULL
                    ORDER BY canonical.created_at, canonical.id
                    LIMIT 1
                )
                WHERE repository_scope_id IS NOT NULL;

                CREATE TABLE IF NOT EXISTS camp_view_state (
                    camp_id TEXT PRIMARY KEY REFERENCES camp(id),
                    last_seen_global_sequence INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS legacy_import_map (
                    source_type TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    target_entity_type TEXT NOT NULL,
                    target_entity_id TEXT NOT NULL,
                    imported_at TEXT NOT NULL,
                    PRIMARY KEY(source_type, source_id),
                    UNIQUE(target_entity_type, target_entity_id)
                );

                CREATE TABLE IF NOT EXISTS migration_diagnostic (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    migration_version INTEGER NOT NULL,
                    code TEXT NOT NULL,
                    legacy_entity_type TEXT NOT NULL,
                    legacy_entity_id TEXT NOT NULL,
                    detail TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS migration_diagnostic_version_idx
                    ON migration_diagnostic(migration_version, id);

                CREATE INDEX IF NOT EXISTS agent_profile_member_order_idx
                    ON agent_profile(profile_status, member_order, id);
                "#,
            )?;

            let profile_ids = {
                let mut statement = transaction.prepare(
                    r#"
                    SELECT id
                    FROM agent_profile
                    ORDER BY CASE id WHEN 'agent-luoke' THEN 0 ELSE 1 END,
                             created_at, id
                    "#,
                )?;
                statement
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?
            };
            for (member_order, profile_id) in profile_ids.iter().enumerate() {
                transaction.execute(
                    "UPDATE agent_profile SET member_order = ?2 WHERE id = ?1",
                    params![profile_id, member_order as i64],
                )?;
            }

            Self::import_legacy_task_camps(&transaction)?;

            let camp_titles = {
                let mut statement = transaction.prepare("SELECT id, title FROM camp")?;
                statement
                    .query_map([], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?
            };
            for (camp_id, title) in camp_titles {
                let normalized = title.split_whitespace().collect::<Vec<_>>().join(" ");
                transaction.execute(
                    "UPDATE camp SET title = ?2 WHERE id = ?1",
                    params![
                        camp_id,
                        if normalized.is_empty() {
                            "新对话"
                        } else {
                            &normalized
                        }
                    ],
                )?;
            }

            transaction.commit()?;
            Ok(())
        })();
        let foreign_keys_result = self.connection.execute_batch("PRAGMA foreign_keys = ON;");
        migration_result?;
        foreign_keys_result?;

        let violation = self
            .connection
            .query_row("PRAGMA foreign_key_check", [], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .optional()?;
        if let Some((table, row_id)) = violation {
            anyhow::bail!("v11 migration left a foreign-key violation in {table} row {row_id}");
        }
        Ok(())
    }

    fn import_legacy_task_camps(transaction: &Transaction<'_>) -> Result<()> {
        #[derive(Debug)]
        struct LegacyTask {
            id: String,
            title: String,
            source_camp_id: Option<String>,
            created_at: String,
            updated_at: String,
            project_kind: Option<String>,
            project_root: Option<String>,
            git_common_dir: Option<String>,
        }

        let candidates = {
            let mut statement = transaction.prepare(
                r#"
                SELECT task.id, task.title, task.camp_id,
                       task.created_at, task.updated_at,
                       project.kind, project.root_path, project.git_common_dir
                FROM task
                LEFT JOIN project ON project.id = task.project_id
                LEFT JOIN legacy_import_map
                  ON legacy_import_map.source_type = 'legacy_task'
                 AND legacy_import_map.source_id = task.id
                WHERE task.created_by_id IN ('legacy-task-api', 'v0.02-migration')
                  AND task.camp_id = 'camp-' || task.project_id
                  AND legacy_import_map.source_id IS NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM agent_run WHERE agent_run.task_id = task.id
                  )
                ORDER BY task.created_at, task.id
                "#,
            )?;
            statement
                .query_map([], |row| {
                    Ok(LegacyTask {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        source_camp_id: row.get(2)?,
                        created_at: row.get(3)?,
                        updated_at: row.get(4)?,
                        project_kind: row.get(5)?,
                        project_root: row.get(6)?,
                        git_common_dir: row.get(7)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        let active_profiles = {
            let mut statement = transaction.prepare(
                r#"
                SELECT id FROM agent_profile
                WHERE profile_status = 'active'
                ORDER BY member_order, id
                "#,
            )?;
            statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        let mut source_camps = std::collections::BTreeSet::new();
        for task in candidates {
            if let Some(source_camp_id) = &task.source_camp_id {
                source_camps.insert(source_camp_id.clone());
            }
            let title = task.title.split_whitespace().collect::<Vec<_>>().join(" ");
            let valid_project = match task.project_kind.as_deref() {
                Some("lobby") => task
                    .project_root
                    .as_deref()
                    .is_some_and(|root| !root.trim().is_empty() && Path::new(root).is_absolute()),
                Some("git") => {
                    task.project_root.as_deref().is_some_and(|root| {
                        !root.trim().is_empty() && Path::new(root).is_absolute()
                    }) && task.git_common_dir.as_deref().is_some_and(|common| {
                        !common.trim().is_empty() && Path::new(common).is_absolute()
                    })
                }
                _ => false,
            };
            if title.is_empty() || !valid_project || active_profiles.is_empty() {
                let reason = if title.is_empty() {
                    "legacy Task has no usable title"
                } else if !valid_project {
                    "legacy Task has no verifiable Project binding"
                } else {
                    "legacy Task cannot form a Camp without active AgentProfiles"
                };
                transaction.execute(
                    r#"
                    INSERT INTO migration_diagnostic(
                        migration_version, code, legacy_entity_type,
                        legacy_entity_id, detail, created_at
                    ) VALUES (11, 'legacy_task_discarded', 'task', ?1, ?2, ?3)
                    "#,
                    params![task.id, reason, chrono::Utc::now().to_rfc3339()],
                )?;
                Self::delete_legacy_task_relation_set(transaction, &task.id)?;
                continue;
            }

            let project_root = task
                .project_root
                .as_deref()
                .context("validated legacy Project unexpectedly has no root path")?;
            let is_repository = task.project_kind.as_deref() == Some("git");
            let git_common_dir = is_repository.then_some(
                task.git_common_dir
                    .as_deref()
                    .context("validated Git Project unexpectedly has no common directory")?,
            );
            let repository_scope_id = if let Some(git_common_dir) = git_common_dir {
                transaction
                    .query_row(
                        r#"
                        SELECT repository_scope_id FROM camp
                        WHERE repository_git_common_dir = ?1
                          AND repository_object_format = 'sha1'
                          AND repository_scope_id IS NOT NULL
                        ORDER BY created_at, id LIMIT 1
                        "#,
                        [git_common_dir],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?
                    .or_else(|| Some(format!("repository-scope-{}", Uuid::new_v4())))
            } else {
                None
            };
            let camp_id = Uuid::new_v4().to_string();
            let internal_ref = is_repository.then(|| format!("refs/rovai/camps/{camp_id}"));
            let lead = active_profiles
                .first()
                .context("active profiles disappeared")?;
            transaction.execute(
                r#"
                INSERT INTO camp(
                    id, title, project_path,
                    repository_scope_id, repository_git_common_dir,
                    repository_object_format, repository_internal_ref_namespace,
                    repository_bound_at, repository_relocated_at,
                    default_lead_agent_id, status, last_message_sequence,
                    version, created_at, updated_at, archived_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL,
                    ?9, 'active', 0, 1, ?10, ?11, NULL
                )
                "#,
                params![
                    camp_id,
                    title,
                    project_root,
                    repository_scope_id,
                    git_common_dir,
                    is_repository.then_some("sha1"),
                    internal_ref,
                    is_repository.then_some(task.created_at.as_str()),
                    lead,
                    task.created_at,
                    task.updated_at,
                ],
            )?;
            for profile_id in &active_profiles {
                transaction.execute(
                    r#"
                    INSERT INTO camp_member(
                        camp_id, agent_profile_id, status, capability_overrides_json,
                        leave_requested_at, leave_request_command_id,
                        pending_default_lead_successor_agent_id,
                        version, joined_at, left_at
                    ) VALUES (?1, ?2, 'active', '{}', NULL, NULL, NULL, 1, ?3, NULL)
                    "#,
                    params![camp_id, profile_id, task.created_at],
                )?;
                transaction.execute(
                    r#"
                    INSERT INTO conversation(
                        id, camp_id, agent_profile_id,
                        provider_override, model_override, action_permission_profile_ref,
                        native_session_id, summary,
                        summary_through_message_sequence,
                        last_message_sequence,
                        version, created_at, updated_at
                    ) VALUES (?1, ?2, ?3, NULL, NULL, NULL, NULL, NULL, 0, 0, 1, ?4, ?4)
                    "#,
                    params![
                        Uuid::new_v4().to_string(),
                        camp_id,
                        profile_id,
                        task.created_at
                    ],
                )?;
            }
            transaction.execute(
                "UPDATE task SET camp_id = ?2 WHERE id = ?1",
                params![task.id, camp_id],
            )?;
            transaction.execute(
                "UPDATE event_log SET camp_id = ?2 WHERE task_id = ?1",
                params![task.id, camp_id],
            )?;
            transaction.execute(
                r#"
                INSERT INTO legacy_import_map(
                    source_type, source_id, target_entity_type,
                    target_entity_id, imported_at
                ) VALUES ('legacy_task', ?1, 'camp', ?2, ?3)
                "#,
                params![task.id, camp_id, chrono::Utc::now().to_rfc3339()],
            )?;
        }

        for source_camp_id in source_camps {
            let retained_facts: i64 = transaction.query_row(
                r#"
                SELECT
                    (SELECT COUNT(*) FROM task WHERE camp_id = ?1)
                  + (SELECT COUNT(*) FROM camp_message WHERE camp_id = ?1)
                  + (SELECT COUNT(*) FROM camp_turn WHERE camp_id = ?1)
                "#,
                [&source_camp_id],
                |row| row.get(0),
            )?;
            if retained_facts == 0 {
                transaction.execute(
                    "DELETE FROM conversation WHERE camp_id = ?1",
                    [&source_camp_id],
                )?;
                transaction.execute(
                    "DELETE FROM camp_member WHERE camp_id = ?1",
                    [&source_camp_id],
                )?;
                transaction.execute("DELETE FROM camp WHERE id = ?1", [&source_camp_id])?;
            }
        }
        Ok(())
    }

    fn delete_legacy_task_relation_set(transaction: &Transaction<'_>, task_id: &str) -> Result<()> {
        transaction.execute(
            "DELETE FROM task_evidence_binding WHERE task_id = ?1",
            [task_id],
        )?;
        transaction.execute("DELETE FROM approval WHERE task_id = ?1", [task_id])?;
        transaction.execute("DELETE FROM artifact WHERE task_id = ?1", [task_id])?;
        transaction.execute(
            "DELETE FROM turn WHERE runtime_session_id IN (SELECT id FROM runtime_session WHERE task_id = ?1)",
            [task_id],
        )?;
        transaction.execute("DELETE FROM runtime_session WHERE task_id = ?1", [task_id])?;
        transaction.execute(
            "DELETE FROM task_dependency WHERE task_id = ?1 OR depends_on_task_id = ?1",
            [task_id],
        )?;
        transaction.execute("DELETE FROM event_log WHERE task_id = ?1", [task_id])?;
        transaction.execute("DELETE FROM task WHERE id = ?1", [task_id])?;
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
                "[\"task.create\",\"task.update\",\"agent_run.create\",\"agent_run.retry\",\"agent_run.cancel\",\"inbox.send\",\"memory.propose_change\"]",
            ),
            (
                "agent-muwa",
                "muwa",
                "沐瓦",
                "水獭",
                "核心开发",
                "直接在用户选择的项目目录中实现代码、运行验证并交付可检查的变更。",
                "#3F8F83",
                "[\"task.create\",\"task.update\",\"agent_run.create\",\"agent_run.retry\",\"agent_run.cancel\",\"inbox.send\",\"workspace.bind\",\"action.request\",\"memory.propose_change\"]",
            ),
            (
                "agent-mianzhi",
                "mianzhi",
                "眠枝",
                "小角鸮",
                "审查专家",
                "独立检查正确性、风险、回归和证据，不用多数意见掩盖分歧。",
                "#7A6FA8",
                "[\"task.create\",\"task.update\",\"agent_run.create\",\"inbox.send\",\"memory.propose_change\"]",
            ),
            (
                "agent-qilu",
                "qilu",
                "绮露",
                "耳廓狐",
                "UI/UX 设计师",
                "在涉及体验时给出交互、视觉、可访问性和平台一致性约束。",
                "#D79B45",
                "[\"task.create\",\"task.update\",\"agent_run.create\",\"inbox.send\",\"memory.propose_change\"]",
            ),
        ];

        let transaction = self.connection.transaction()?;
        for (member_order, profile) in profiles.into_iter().enumerate() {
            transaction.execute(
                r#"
                INSERT OR IGNORE INTO agent_profile (
                    id, slug, handle, display_name, species, persona_label,
                    role_title, role_contract, role_description,
                    instructions, default_capabilities_json,
                    accent, runtime_enabled, member_order, created_at, updated_at
                ) VALUES (
                    ?1, ?2, ?2, ?3, ?4, ?4,
                    ?5, ?6, ?6,
                    ?6, ?8,
                    ?7, 0, ?10, ?9, ?9
                )
                "#,
                params![
                    profile.0,
                    profile.1,
                    profile.2,
                    profile.3,
                    profile.4,
                    profile.5,
                    profile.6,
                    profile.7,
                    now,
                    member_order as i64,
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
        self.connection
            .execute("UPDATE agent_profile SET runtime_enabled = 0", [])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_database_seeds_durable_companions() {
        let directory = std::env::temp_dir().join(format!("rovai-db-test-{}", Uuid::new_v4()));
        let database = Database::open(&directory).expect("database should open");
        assert_eq!(database.path(), directory.join("rovai.sqlite"));
        let (agent_count, runtime_enabled_count): (i64, i64) = database
            .connection()
            .query_row(
                "SELECT COUNT(*), SUM(runtime_enabled) FROM agent_profile",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("AgentProfile count");
        assert_eq!(agent_count, 4);
        assert_eq!(runtime_enabled_count, 0);
        let proposal_capability_count: i64 = database
            .connection()
            .query_row(
                r#"
                SELECT COUNT(*)
                FROM agent_profile
                WHERE EXISTS (
                    SELECT 1
                    FROM json_each(agent_profile.default_capabilities_json)
                    WHERE json_each.value = 'memory.propose_change'
                )
                "#,
                [],
                |row| row.get(0),
            )
            .expect("Starter Memory Proposal capability count");
        assert_eq!(proposal_capability_count, 4);
        let muwa_role: String = database
            .connection()
            .query_row(
                "SELECT role_contract FROM agent_profile WHERE slug = 'muwa'",
                [],
                |row| row.get(0),
            )
            .expect("Muwa role contract");
        assert!(muwa_role.contains("项目目录"));
        let project_count: i64 = database
            .connection()
            .query_row("SELECT COUNT(*) FROM project", [], |row| row.get(0))
            .expect("Project count");
        let camp_count: i64 = database
            .connection()
            .query_row("SELECT COUNT(*) FROM camp", [], |row| row.get(0))
            .expect("Camp count");
        assert_eq!(project_count, 0);
        assert_eq!(camp_count, 0);
        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn existing_lumen_database_is_reused_only_when_rovai_database_is_absent() {
        let directory =
            std::env::temp_dir().join(format!("rovai-db-legacy-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let legacy_path = directory.join("lumen.sqlite");
        drop(Connection::open(&legacy_path).unwrap());

        let database = Database::open(&directory).expect("legacy database should open");
        assert_eq!(database.path(), legacy_path);
        drop(database);

        let preferred_path = directory.join("rovai.sqlite");
        drop(Connection::open(&preferred_path).unwrap());
        let database = Database::open(&directory).expect("preferred database should open");
        assert_eq!(database.path(), preferred_path);
        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn v17_resets_collaboration_and_preserves_member_and_adapter_configuration() {
        use crate::{
            collaboration::{CollaborationService, CreateCampCommand, CreateTaskCommand},
            command::{ActorRef, CommandEnvelope},
        };

        let directory = std::env::temp_dir().join(format!("rovai-db-v17-test-{}", Uuid::new_v4()));
        let mut database = Database::open(&directory).expect("database should open");
        database
            .connection
            .execute(
                r#"
                UPDATE agent_profile
                SET display_name = '自定义洛可', member_order = 9,
                    default_capabilities_json = '["task.cancel","custom.capability"]'
                WHERE id = 'agent-luoke'
                "#,
                [],
            )
            .unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        database
            .connection
            .execute(
                r#"
                INSERT INTO adapter_installation(
                    id, adapter_kind, executable_path, source, auth_scope,
                    enabled, version, created_at, updated_at
                ) VALUES (
                    'adapter-preserved', 'codex-cli', '/usr/local/bin/codex',
                    'custom', 'local-user', 1, 1, ?1, ?1
                )
                "#,
                [&now],
            )
            .unwrap();
        let service = CollaborationService::default();
        let camp = service
            .create_camp(
                &mut database,
                &CommandEnvelope {
                    command_id: "v17-camp".to_string(),
                    actor: ActorRef::User {
                        user_id: "local-user".to_string(),
                    },
                    camp_id: None,
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: CreateCampCommand {
                        project_path: directory.join("workspace").to_string_lossy().to_string(),
                        repository: None,
                    },
                },
            )
            .unwrap();
        let camp_id = camp.result.payload["campId"].as_str().unwrap().to_string();
        service
            .create_task(
                &mut database,
                &CommandEnvelope {
                    command_id: "v17-task".to_string(),
                    actor: ActorRef::User {
                        user_id: "local-user".to_string(),
                    },
                    camp_id: Some(camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: CreateTaskCommand {
                        camp_id,
                        title: "will be reset".to_string(),
                        description: String::new(),
                        assignee_agent_id: None,
                    },
                },
            )
            .unwrap();

        database
            .connection
            .execute_batch(
                r#"
                CREATE TABLE task_dependency(dummy TEXT);
                CREATE TABLE task_evidence_binding(dummy TEXT);
                DELETE FROM schema_migration WHERE version = 17;
                "#,
            )
            .unwrap();
        database
            .migrate_lightweight_task_v17()
            .expect("v17 reset should succeed");

        for table in ["camp", "task", "camp_message", "agent_run"] {
            let count: i64 = database
                .connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "{table} should be reset");
        }
        let profile: (String, i64, String) = database
            .connection
            .query_row(
                r#"
                SELECT display_name, member_order, default_capabilities_json
                FROM agent_profile WHERE id = 'agent-luoke'
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(profile.0, "自定义洛可");
        assert_eq!(profile.1, 9);
        assert!(profile.2.contains("custom.capability"));
        assert!(profile.2.contains("task.create"));
        assert!(profile.2.contains("task.update"));
        assert!(!profile.2.contains("task.cancel"));
        let installation_count: i64 = database
            .connection
            .query_row(
                "SELECT COUNT(*) FROM adapter_installation WHERE id = 'adapter-preserved'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(installation_count, 1);

        let task_columns = database
            .connection
            .prepare("PRAGMA table_info(task)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(
            task_columns,
            vec![
                "id",
                "camp_id",
                "title",
                "description",
                "status",
                "assignee_agent_id",
                "created_by_type",
                "created_by_id",
                "source_agent_run_id",
                "version",
                "created_at",
                "updated_at",
                "closed_at",
            ]
        );
        for removed_table in ["task_dependency", "task_evidence_binding"] {
            let exists: i64 = database
                .connection
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [removed_table],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(exists, 0);
        }
        drop(database);

        let reopened = Database::open(&directory).expect("v17 database should reopen");
        let migration_count: i64 = reopened
            .connection
            .query_row(
                "SELECT COUNT(*) FROM schema_migration WHERE version = 17",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(migration_count, 1);
        let preserved_name: String = reopened
            .connection
            .query_row(
                "SELECT display_name FROM agent_profile WHERE id = 'agent-luoke'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(preserved_name, "自定义洛可");
        drop(reopened);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn v18_adds_frozen_task_context_to_existing_context_manifests() {
        let directory = std::env::temp_dir().join(format!("rovai-db-v18-test-{}", Uuid::new_v4()));
        let database = Database::open(&directory).expect("database should open");
        database
            .connection
            .execute_batch(
                r#"
                ALTER TABLE context_manifest DROP COLUMN task_context_json;
                ALTER TABLE context_manifest DROP COLUMN task_context_digest;
                DELETE FROM schema_migration WHERE version = 18;
                "#,
            )
            .expect("test should restore the pre-v18 ContextManifest shape");
        drop(database);

        let reopened = Database::open(&directory).expect("v18 database should reopen");
        let columns = reopened
            .connection
            .prepare("PRAGMA table_info(context_manifest)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert!(columns.contains(&"task_context_json".to_string()));
        assert!(columns.contains(&"task_context_digest".to_string()));
        let migration_count: i64 = reopened
            .connection
            .query_row(
                "SELECT COUNT(*) FROM schema_migration WHERE version = 18",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(migration_count, 1);
        drop(reopened);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn v19_adds_skill_library_and_context_exposure_to_existing_databases() {
        let directory = std::env::temp_dir().join(format!("rovai-db-v19-test-{}", Uuid::new_v4()));
        let database = Database::open(&directory).expect("database should open");
        database
            .connection
            .execute_batch(
                r#"
                DROP TABLE skill_projection_observation;
                DROP TABLE skill_revision;
                DROP TABLE skill;
                ALTER TABLE context_manifest DROP COLUMN skill_exposure_json;
                ALTER TABLE context_manifest DROP COLUMN skill_exposure_digest;
                DELETE FROM schema_migration WHERE version = 19;
                "#,
            )
            .expect("test should restore the pre-v19 schema");
        drop(database);

        let reopened = Database::open(&directory).expect("v19 database should reopen");
        for table in ["skill", "skill_revision", "skill_projection_observation"] {
            let exists: i64 = reopened
                .connection
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [table],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(exists, 1, "{table} should be created by migration v19");
        }
        let columns = reopened
            .connection
            .prepare("PRAGMA table_info(context_manifest)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert!(columns.contains(&"skill_exposure_json".to_string()));
        assert!(columns.contains(&"skill_exposure_digest".to_string()));
        let migration_count: i64 = reopened
            .connection
            .query_row(
                "SELECT COUNT(*) FROM schema_migration WHERE version = 19",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(migration_count, 1);
        drop(reopened);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn v20_adds_mcp_exposure_to_existing_context_manifests() {
        let directory = std::env::temp_dir().join(format!("rovai-db-v20-test-{}", Uuid::new_v4()));
        let database = Database::open(&directory).expect("database should open");
        database
            .connection
            .execute_batch(
                r#"
                ALTER TABLE context_manifest DROP COLUMN mcp_exposure_json;
                ALTER TABLE context_manifest DROP COLUMN mcp_exposure_digest;
                ALTER TABLE context_manifest DROP COLUMN mcp_projection_digest;
                DELETE FROM schema_migration WHERE version = 20;
                "#,
            )
            .expect("test should restore the pre-v20 schema");
        drop(database);

        let reopened = Database::open(&directory).expect("v20 database should reopen");
        let columns = reopened
            .connection
            .prepare("PRAGMA table_info(context_manifest)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert!(columns.contains(&"mcp_exposure_json".to_string()));
        assert!(columns.contains(&"mcp_exposure_digest".to_string()));
        assert!(columns.contains(&"mcp_projection_digest".to_string()));
        let migration_count: i64 = reopened
            .connection
            .query_row(
                "SELECT COUNT(*) FROM schema_migration WHERE version = 20",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(migration_count, 1);
        drop(reopened);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn v21_adds_memory_store_guide_and_default_proposal_capability() {
        let directory = std::env::temp_dir().join(format!("rovai-db-v21-test-{}", Uuid::new_v4()));
        let database = Database::open(&directory).expect("database should open");
        database
            .connection
            .execute_batch(
                r#"
                PRAGMA foreign_keys = OFF;
                DROP TABLE memory_projection_observation;
                DROP TABLE memory_supersession;
                DROP TABLE memory_proposal;
                DROP TABLE memory_revision;
                DROP TABLE memory;
                ALTER TABLE context_manifest DROP COLUMN memory_guide_json;
                ALTER TABLE context_manifest DROP COLUMN memory_guide_digest;
                UPDATE agent_profile
                SET default_capabilities_json = '["task.create"]'
                WHERE id = 'agent-luoke';
                DELETE FROM schema_migration WHERE version = 21;
                PRAGMA foreign_keys = ON;
                "#,
            )
            .expect("test should restore the pre-v21 schema");
        drop(database);

        let reopened = Database::open(&directory).expect("v21 database should reopen");
        for table in [
            "memory",
            "memory_revision",
            "memory_proposal",
            "memory_supersession",
            "memory_projection_observation",
        ] {
            let count: i64 = reopened
                .connection
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [table],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "{table} should exist");
        }
        let columns = reopened
            .connection
            .prepare("PRAGMA table_info(context_manifest)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert!(columns.contains(&"memory_guide_json".to_string()));
        assert!(columns.contains(&"memory_guide_digest".to_string()));
        let capabilities: String = reopened
            .connection
            .query_row(
                "SELECT default_capabilities_json FROM agent_profile WHERE id = 'agent-luoke'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(
            serde_json::from_str::<Vec<String>>(&capabilities)
                .unwrap()
                .contains(&"memory.propose_change".to_string())
        );
        let foreign_key_violations: i64 = reopened
            .connection
            .prepare("PRAGMA foreign_key_check")
            .unwrap()
            .query_map([], |_| Ok(()))
            .unwrap()
            .count() as i64;
        assert_eq!(foreign_key_violations, 0);
        let migration_count: i64 = reopened
            .connection
            .query_row(
                "SELECT COUNT(*) FROM schema_migration WHERE version = 21",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(migration_count, 1);
        drop(reopened);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn v22_migrates_public_trigger_before_removing_materialized_message() {
        use crate::{
            agent_profile::configure_test_runtime,
            collaboration::{
                CollaborationService, CreateCampFromFirstMessageCommand, MessageAddressSpec,
            },
            command::{ActorRef, CommandEnvelope},
        };

        let directory = std::env::temp_dir().join(format!("rovai-db-v22-test-{}", Uuid::new_v4()));
        let mut database = Database::open(&directory).expect("database should open");
        configure_test_runtime(&database, &["agent-luoke"]);
        let created = CollaborationService::default()
            .create_camp_from_first_message(
                &mut database,
                &CommandEnvelope {
                    command_id: "v22-create".to_string(),
                    actor: ActorRef::User {
                        user_id: "local-user".to_string(),
                    },
                    camp_id: None,
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: CreateCampFromFirstMessageCommand {
                        project_path: directory.join("workspace").to_string_lossy().to_string(),
                        repository: None,
                        body: "legacy public trigger".to_string(),
                        address: MessageAddressSpec::Default,
                        purpose: "migration test".to_string(),
                        expected_output: "migration result".to_string(),
                    },
                },
            )
            .expect("legacy fixture should be created");
        let camp_id = created.result.payload["campId"]
            .as_str()
            .unwrap()
            .to_string();
        let agent_run_id = created.result.payload["agentRunIds"][0]
            .as_str()
            .unwrap()
            .to_string();
        let (conversation_id, camp_turn_id, camp_message_id): (String, String, String) = database
            .connection()
            .query_row(
                r#"
                SELECT agent_run.conversation_id, agent_run.camp_turn_id,
                       agent_run.trigger_camp_message_id
                FROM agent_run
                WHERE agent_run.id = ?1
                "#,
                [&agent_run_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO conversation_message(
                    id, conversation_id, sequence, author_type, author_id,
                    source_agent_run_id, body, source_camp_message_id,
                    source_inbox_message_id, camp_turn_id, agent_run_id, created_at
                ) VALUES (
                    'legacy-materialized-trigger', ?1, 1, 'user', 'local-user',
                    NULL, 'legacy public trigger', ?2, NULL, ?3, NULL, ?4
                )
                "#,
                params![conversation_id, camp_message_id, camp_turn_id, now],
            )
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                UPDATE conversation
                SET last_message_sequence = 1,
                    native_read_through_camp_message_sequence = 1
                WHERE id = ?1
                "#,
                [&conversation_id],
            )
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                UPDATE agent_run
                SET trigger_camp_message_id = NULL,
                    trigger_conversation_message_id = 'legacy-materialized-trigger',
                    final_conversation_message_id = 'legacy-materialized-trigger',
                    status = 'waiting',
                    wait_reason = 'context_compaction',
                    updated_at = ?2
                WHERE id = ?1
                "#,
                params![agent_run_id, now],
            )
            .unwrap();
        database
            .connection()
            .execute(
                "UPDATE camp_turn SET status = 'waiting', updated_at = ?2 WHERE id = ?1",
                params![camp_turn_id, now],
            )
            .unwrap();

        database
            .connection()
            .execute_batch(
                r#"
                DROP TRIGGER camp_message_fts_insert;
                DROP TRIGGER camp_message_fts_delete;
                DROP TRIGGER camp_message_fts_update;
                DROP TRIGGER camp_summary_fts_insert;
                DROP TRIGGER camp_summary_fts_delete;
                DROP TRIGGER camp_summary_immutable;
                DROP TABLE camp_message_fts;
                DROP TABLE camp_summary_fts;
                DROP TABLE context_compaction_waiter;
                DROP TABLE context_compaction_attempt;
                DROP TABLE camp_summary_frontier;
                DROP TABLE camp_summary;
                DROP TABLE context_summary_config;
                DROP TABLE camp_message_reference;
                DROP TABLE camp_message_mention;
                DROP TABLE context_index_meta;

                ALTER TABLE context_manifest DROP COLUMN camp_summary_ids_json;
                ALTER TABLE context_manifest DROP COLUMN coverage_baseline_sequence;
                ALTER TABLE context_manifest ADD COLUMN
                    context_summary_ids_json TEXT NOT NULL DEFAULT '[]';
                ALTER TABLE conversation
                    RENAME COLUMN native_read_through_camp_message_sequence
                    TO native_delivered_camp_message_sequence;
                ALTER TABLE conversation ADD COLUMN
                    last_seen_camp_message_sequence INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE camp_message DROP COLUMN content_digest;

                CREATE TABLE context_summary (
                    id TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL REFERENCES conversation(id)
                );
                CREATE TABLE context_compaction_attempt (
                    id TEXT PRIMARY KEY,
                    agent_run_id TEXT NOT NULL REFERENCES agent_run(id),
                    conversation_id TEXT NOT NULL REFERENCES conversation(id)
                );
                INSERT INTO context_compaction_attempt(
                    id, agent_run_id, conversation_id
                )
                SELECT 'legacy-attempt', id, conversation_id
                FROM agent_run
                WHERE id = (
                    SELECT id FROM agent_run ORDER BY created_at LIMIT 1
                );
                DELETE FROM schema_migration WHERE version = 22;
                "#,
            )
            .expect("test should restore the relevant pre-v22 shape");
        drop(database);

        let reopened = Database::open(&directory).expect("v22 database should reopen");
        type MigratedRunState = (
            Option<String>,
            Option<String>,
            Option<String>,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
        );
        let run: MigratedRunState = reopened
            .connection()
            .query_row(
                r#"
                SELECT trigger_camp_message_id, trigger_conversation_message_id,
                       final_conversation_message_id, status, wait_reason,
                       last_error_code, ended_at
                FROM agent_run
                WHERE id = ?1
                "#,
                [&agent_run_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(run.0.as_deref(), Some(camp_message_id.as_str()));
        assert_eq!(run.1, None);
        assert_eq!(run.2, None);
        assert_eq!(run.3, "cancelled");
        assert_eq!(run.4, None);
        assert_eq!(run.5.as_deref(), Some("superseded_by_v012_migration"));
        assert!(run.6.is_some());
        let materialized_count: i64 = reopened
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM conversation_message WHERE source_camp_message_id IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(materialized_count, 0);
        let (marker, content_digest, turn_status): (i64, String, String) = reopened
            .connection()
            .query_row(
                r#"
                SELECT conversation.native_read_through_camp_message_sequence,
                       camp_message.content_digest, camp_turn.status
                FROM conversation
                JOIN camp_message ON camp_message.id = ?2
                JOIN camp_turn ON camp_turn.id = ?3
                WHERE conversation.id = ?1
                "#,
                params![conversation_id, camp_message_id, camp_turn_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(marker, 1);
        assert!(content_digest.starts_with("sha256:"));
        assert_eq!(turn_status, "failed");
        let old_marker_column: i64 = reopened
            .connection()
            .query_row(
                r#"
                SELECT COUNT(*) FROM pragma_table_info('conversation')
                WHERE name IN (
                    'native_delivered_camp_message_sequence',
                    'last_seen_camp_message_sequence'
                )
                "#,
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(old_marker_column, 0);
        let migration_count: i64 = reopened
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM schema_migration WHERE version = 22",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(migration_count, 1);
        let foreign_key_violations = reopened
            .connection()
            .prepare("PRAGMA foreign_key_check")
            .unwrap()
            .query_map([], |_| Ok(()))
            .unwrap()
            .count();
        assert_eq!(foreign_key_violations, 0);
        assert_eq!(camp_id.len(), 36);
        drop(reopened);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }
}
