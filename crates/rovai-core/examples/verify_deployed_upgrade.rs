//! Explicit isolated-copy acceptance. Runs production admission/migration, never
//! Core startup, Runtime recovery, channels, or a Skill Library.
fn main() -> anyhow::Result<()> {
    use rovai_core::{
        authority_migration::AuthorityMigrationRunner,
        core_data_dir_lock::CoreDataDirLease,
        database_admission::{AdmissionAssessment, DatabaseAdmission},
        read_model::ReadModelService,
    };
    use std::{path::Path, time::Instant};
    let args: Vec<_> = std::env::args().collect();
    anyhow::ensure!(
        args.len() == 4 && args[1] == "--isolated-copy",
        "usage: verify_deployed_upgrade --isolated-copy TEMP_FIXTURE CAMP_ID"
    );
    let root = Path::new(&args[2]).canonicalize()?;
    let temporary = std::env::temp_dir().canonicalize()?;
    anyhow::ensure!(
        root.starts_with(&temporary)
            && root
                .file_name()
                .and_then(|v| v.to_str())
                .is_some_and(|v| v.starts_with("rovai-joined-upgrade-")),
        "only explicitly named copies under the OS temporary directory are accepted"
    );
    anyhow::ensure!(
        root.join("rovai.sqlite").is_file(),
        "an existing copied database is required"
    );
    let lease = CoreDataDirLease::acquire(&root)?;
    let AdmissionAssessment::RequiresMigration(ticket) = DatabaseAdmission::assess(&lease)? else {
        anyhow::bail!("copy must be an admitted migration source");
    };
    let started = Instant::now();
    let mut database = AuthorityMigrationRunner::run(
        *ticket,
        &root.join("runtime-files"),
        "isolated-upgrade-acceptance",
    )?;
    let migration_ms = started.elapsed().as_secs_f64() * 1000.;
    let started = Instant::now();
    let projection = ReadModelService.camp_open_projection(&mut database, &args[3])?;
    println!(
        "{}",
        serde_json::json!({
            "migrationMs": migration_ms, "campOpenMs": started.elapsed().as_secs_f64()*1000.,
            "runs": projection.agent_runs.len(), "passed": true,
            "scope": "Production admission/migration/Camp Open on an isolated copy; no Core startup or Runtime"
        })
    );
    Ok(())
}
