use crate::{agent_profile::configure_test_runtime, db::Database};
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
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;")
        .expect("test database template should checkpoint");
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

fn clone_template(template: &TestDatabaseTemplate, kind: &str) -> (Database, PathBuf) {
    let directory = unique_directory(kind);
    let database = clone_template_to(template, &directory);
    (database, directory)
}

fn clone_template_to(template: &TestDatabaseTemplate, directory: &Path) -> Database {
    assert_clean_template(&template.directory, &template.database_path);
    std::fs::create_dir_all(directory).expect("test database clone directory should exist");
    std::fs::copy(&template.database_path, directory.join("rovai.sqlite"))
        .expect("test database template should copy");
    Database::open(directory).expect("cloned test database should open")
}

#[cfg(feature = "slow-tests")]
pub(crate) fn fresh_schema_database() -> (Database, PathBuf) {
    clone_template(
        FRESH_SCHEMA_TEMPLATE.get_or_init(|| build_template("fresh-template", false)),
        "fresh-clone",
    )
}

pub(crate) fn seeded_runtime_database() -> (Database, PathBuf) {
    clone_template(
        SEEDED_RUNTIME_TEMPLATE.get_or_init(|| build_template("seeded-template", true)),
        "seeded-clone",
    )
}

pub(crate) fn seeded_runtime_database_owned() -> OwnedTestDatabase {
    let (database, directory) = seeded_runtime_database();
    OwnedTestDatabase::new(database, directory)
}

#[cfg(feature = "slow-tests")]
pub(crate) fn fresh_schema_database_at(directory: &Path) -> Database {
    clone_template_to(
        FRESH_SCHEMA_TEMPLATE.get_or_init(|| build_template("fresh-template", false)),
        directory,
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
                    let (database, directory) = fresh_schema_database();
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
                    drop(database);
                    std::fs::remove_dir_all(directory).unwrap();
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
    fn deleting_one_clone_does_not_change_the_template_or_another_clone() {
        let (first, first_directory) = seeded_runtime_database();
        let (second, second_directory) = seeded_runtime_database();
        let second_profiles: i64 = second
            .connection()
            .query_row("SELECT COUNT(*) FROM agent_profile", [], |row| row.get(0))
            .unwrap();
        drop(first);
        std::fs::remove_dir_all(&first_directory).unwrap();
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
        std::fs::remove_dir_all(second_directory).unwrap();

        let template = SEEDED_RUNTIME_TEMPLATE.get().unwrap();
        assert_clean_template(&template.directory, &template.database_path);
    }
}
