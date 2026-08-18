use crate::{
    agent_profile::configure_test_runtime,
    db::{Database, TestDatabaseOpenMode},
};
use std::{
    ops::{Deref, DerefMut},
    path::{Path, PathBuf},
    sync::OnceLock,
};
use uuid::Uuid;

struct TestDatabaseTemplate {
    directory: PathBuf,
    database_path: PathBuf,
}

#[cfg(feature = "slow-tests")]
static FRESH_SCHEMA_TEMPLATE: OnceLock<TestDatabaseTemplate> = OnceLock::new();
static SEEDED_RUNTIME_TEMPLATE: OnceLock<TestDatabaseTemplate> = OnceLock::new();

pub(crate) struct OwnedTestDatabase {
    database: Option<Database>,
    directory: PathBuf,
}

impl OwnedTestDatabase {
    fn new(database: Database, directory: PathBuf) -> Self {
        Self {
            database: Some(database),
            directory,
        }
    }

    pub(crate) fn directory(&self) -> &Path {
        &self.directory
    }

    pub(crate) fn close(&mut self) {
        drop(self.database.take());
    }

    pub(crate) fn reopen_production(&mut self) -> anyhow::Result<&mut Database> {
        self.close();
        self.database = Some(Database::open(&self.directory)?);
        Ok(self
            .database
            .as_mut()
            .expect("production database should be open"))
    }
}

impl Deref for OwnedTestDatabase {
    type Target = Database;

    fn deref(&self) -> &Self::Target {
        self.database
            .as_ref()
            .expect("owned test database is closed")
    }
}

impl DerefMut for OwnedTestDatabase {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.database
            .as_mut()
            .expect("owned test database is closed")
    }
}

impl Drop for OwnedTestDatabase {
    fn drop(&mut self) {
        self.close();
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

fn unique_directory(kind: &str) -> PathBuf {
    std::env::temp_dir().join(format!("rovai-{kind}-{}", Uuid::new_v4()))
}

fn build_template(kind: &str, seed_runtime: bool) -> TestDatabaseTemplate {
    let directory = unique_directory(kind);
    let database_path = directory.join("rovai.sqlite");
    let database = Database::open(&directory).expect("test database template should open");
    if seed_runtime {
        configure_test_runtime(&database, &["agent_1", "agent_2", "agent_3"]);
    }
    database
        .connection()
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE; VACUUM;")
        .expect("test database template should checkpoint");
    let integrity: String = database
        .connection()
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .expect("test database template integrity should be readable");
    assert_eq!(integrity, "ok", "test database template must be valid");
    let foreign_key_violations: i64 = database
        .connection()
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
            row.get(0)
        })
        .expect("test database template foreign keys should be readable");
    assert_eq!(
        foreign_key_violations, 0,
        "test database template must satisfy foreign keys"
    );
    drop(database);
    assert_clean_template(&directory, &database_path);
    TestDatabaseTemplate {
        directory,
        database_path,
    }
}

fn assert_clean_template(directory: &Path, database_path: &Path) {
    assert!(database_path.is_file(), "template database should exist");
    assert!(
        !directory.join("rovai.sqlite-wal").exists(),
        "template must not retain a WAL"
    );
    assert!(
        !directory.join("rovai.sqlite-shm").exists(),
        "template must not retain shared-memory state"
    );
}

fn clone_template(
    template: &TestDatabaseTemplate,
    kind: &str,
    mode: TestDatabaseOpenMode,
) -> (Database, PathBuf) {
    let directory = unique_directory(kind);
    let database = clone_template_to(template, &directory, mode);
    (database, directory)
}

fn clone_template_owned(
    template: &TestDatabaseTemplate,
    kind: &str,
    mode: TestDatabaseOpenMode,
) -> OwnedTestDatabase {
    let (database, directory) = clone_template(template, kind, mode);
    OwnedTestDatabase::new(database, directory)
}

fn clone_template_to(
    template: &TestDatabaseTemplate,
    directory: &Path,
    mode: TestDatabaseOpenMode,
) -> Database {
    assert_clean_template(&template.directory, &template.database_path);
    std::fs::create_dir_all(directory).expect("test database clone directory should exist");
    std::fs::copy(&template.database_path, directory.join("rovai.sqlite"))
        .expect("test database template should copy");
    Database::open_verified_test_clone(directory, mode)
        .expect("cloned test database should fast open")
}

#[cfg(feature = "slow-tests")]
pub(crate) fn fresh_schema_database() -> (Database, PathBuf) {
    clone_template(
        FRESH_SCHEMA_TEMPLATE.get_or_init(|| build_template("fresh-template", false)),
        "fresh-clone",
        TestDatabaseOpenMode::ProductionLike,
    )
}

#[cfg(feature = "slow-tests")]
pub(crate) fn fresh_schema_database_fast() -> (Database, PathBuf) {
    clone_template(
        FRESH_SCHEMA_TEMPLATE.get_or_init(|| build_template("fresh-template", false)),
        "fresh-fast-clone",
        TestDatabaseOpenMode::FastIsolated,
    )
}

#[cfg(feature = "slow-tests")]
pub(crate) fn fresh_schema_database_fast_owned() -> OwnedTestDatabase {
    clone_template_owned(
        FRESH_SCHEMA_TEMPLATE.get_or_init(|| build_template("fresh-template", false)),
        "fresh-fast-owned-clone",
        TestDatabaseOpenMode::FastIsolated,
    )
}

pub(crate) fn seeded_runtime_database() -> (Database, PathBuf) {
    clone_template(
        SEEDED_RUNTIME_TEMPLATE.get_or_init(|| build_template("seeded-template", true)),
        "seeded-clone",
        TestDatabaseOpenMode::ProductionLike,
    )
}

pub(crate) fn seeded_runtime_database_owned() -> OwnedTestDatabase {
    clone_template_owned(
        SEEDED_RUNTIME_TEMPLATE.get_or_init(|| build_template("seeded-template", true)),
        "seeded-owned-clone",
        TestDatabaseOpenMode::ProductionLike,
    )
}

pub(crate) fn seeded_runtime_database_fast() -> OwnedTestDatabase {
    clone_template_owned(
        SEEDED_RUNTIME_TEMPLATE.get_or_init(|| build_template("seeded-template", true)),
        "seeded-fast-clone",
        TestDatabaseOpenMode::FastIsolated,
    )
}

#[cfg(feature = "slow-tests")]
pub(crate) fn fresh_schema_database_at(directory: &Path) -> Database {
    clone_template_to(
        FRESH_SCHEMA_TEMPLATE.get_or_init(|| build_template("fresh-template", false)),
        directory,
        TestDatabaseOpenMode::ProductionLike,
    )
}

#[cfg(feature = "slow-tests")]
mod slow_tests {
    use super::*;

    #[test]
    fn cloned_databases_are_parallel_isolated_and_leave_the_template_clean() {
        let workers = (0..2)
            .map(|worker| {
                std::thread::spawn(move || {
                    let database = fresh_schema_database_fast_owned();
                    database
                        .connection()
                        .execute_batch(
                            "CREATE TABLE clone_isolation(value INTEGER NOT NULL);\
                             INSERT INTO clone_isolation(value) VALUES (1);",
                        )
                        .unwrap();
                    let count: i64 = database
                        .connection()
                        .query_row("SELECT COUNT(*) FROM clone_isolation", [], |row| row.get(0))
                        .unwrap();
                    assert_eq!(count, 1, "worker {worker} should see only its own row");
                    let directory = database.directory().to_path_buf();
                    drop(database);
                    assert!(!directory.exists());
                })
            })
            .collect::<Vec<_>>();
        for worker in workers {
            worker.join().unwrap();
        }

        let template = FRESH_SCHEMA_TEMPLATE.get().unwrap();
        assert_clean_template(&template.directory, &template.database_path);
        let connection = rusqlite::Connection::open(&template.database_path).unwrap();
        let leaked: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'clone_isolation'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(leaked, 0);
    }

    #[test]
    fn fast_clone_open_skips_seed_repair_and_production_reopen_runs_it() {
        let mut database = fresh_schema_database_fast_owned();
        database
            .connection()
            .execute(
                "UPDATE agent_profile SET runtime_enabled = 1 WHERE id = 'agent_1'",
                [],
            )
            .unwrap();
        database.close();

        let fast = Database::open_verified_test_clone(
            database.directory(),
            TestDatabaseOpenMode::FastIsolated,
        )
        .unwrap();
        let fast_runtime_enabled: i64 = fast
            .connection()
            .query_row(
                "SELECT runtime_enabled FROM agent_profile WHERE id = 'agent_1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            fast_runtime_enabled, 1,
            "fast open must not run seed repair"
        );
        drop(fast);

        let reopened = database.reopen_production().unwrap();
        let production_runtime_enabled: i64 = reopened
            .connection()
            .query_row(
                "SELECT runtime_enabled FROM agent_profile WHERE id = 'agent_1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            production_runtime_enabled, 0,
            "production reopen must retain the normal seed path"
        );
    }

    #[test]
    fn verified_clone_open_rejects_missing_and_non_current_databases() {
        let missing = unique_directory("missing-fast-clone");
        let error =
            Database::open_verified_test_clone(&missing, TestDatabaseOpenMode::FastIsolated)
                .err()
                .expect("missing database must fail closed");
        assert!(error.to_string().contains("requires an existing SQLite"));
        assert!(!missing.exists());

        let mut database = fresh_schema_database_fast_owned();
        database
            .connection()
            .execute("DELETE FROM schema_migration WHERE version = 93", [])
            .unwrap();
        database.close();
        let error = Database::open_verified_test_clone(
            database.directory(),
            TestDatabaseOpenMode::FastIsolated,
        )
        .err()
        .expect("non-current database must fail closed");
        assert!(
            error
                .to_string()
                .contains("not at the current data contract")
        );
    }

    #[test]
    fn deleting_one_clone_does_not_change_the_template_or_another_clone() {
        let first = seeded_runtime_database_fast();
        let second = seeded_runtime_database_fast();
        let first_directory = first.directory().to_path_buf();
        let second_profiles: i64 = second
            .connection()
            .query_row("SELECT COUNT(*) FROM agent_profile", [], |row| row.get(0))
            .unwrap();
        drop(first);
        assert!(!first_directory.exists());
        assert_eq!(
            second
                .connection()
                .query_row("SELECT COUNT(*) FROM agent_profile", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            second_profiles
        );
        drop(second);

        let template = SEEDED_RUNTIME_TEMPLATE.get().unwrap();
        assert_clean_template(&template.directory, &template.database_path);
    }
}
