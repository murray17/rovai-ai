use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use rusqlite::{Connection, params};
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
                resolved_at = ?1
            WHERE status = 'pending'
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

        self.connection.execute(
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

        self.project_by_root(root_path)?
            .context("project was not found after upsert")
    }

    pub fn ensure_lobby_project(&self, root_path: &Path) -> Result<Project> {
        let root = root_path.to_string_lossy().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        self.connection.execute(
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
        self.get_project(LOBBY_PROJECT_ID)?
            .context("default lobby was not found after insert")
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

    fn project_by_root(&self, root_path: &Path) -> Result<Option<Project>> {
        let root = root_path.to_string_lossy();
        let mut statement = self.connection.prepare(
            r#"
            SELECT id, name, kind, root_path, git_common_dir, created_at, last_opened_at
            FROM project WHERE root_path = ?1
            "#,
        )?;
        let mut rows = statement.query_map([root.as_ref()], project_from_row)?;
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
                execution_root, start_branch, base_revision, created_at, updated_at
            ) VALUES (?1, ?2, 'agent-muwa', ?3, ?4, 'draft', ?5, ?6, ?7, ?8, ?8)
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
                request_json, status, requested_at
            ) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, 'pending', ?7)
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
            SET status = ?2, decision_json = ?3, resolved_at = ?4
            WHERE id = ?1 AND status = 'pending'
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
