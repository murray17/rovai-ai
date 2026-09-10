//! Developer-only metadata export through the production aggregator. No Core startup.
#[cfg(feature = "slow-tests")]
fn main() -> anyhow::Result<()> {
    use rovai_core::{db::Database, execution_trace};
    use std::{fs::OpenOptions, io::Write, path::Path};
    let args: Vec<_> = std::env::args().collect();
    anyhow::ensure!(
        args.len() == 4,
        "usage: export_execution_trace ABSOLUTE_DB PARAMS_JSON NEW_OUTPUT_JSON"
    );
    let params: execution_trace::TraceExportParams =
        serde_json::from_slice(&std::fs::read(&args[2])?)?;
    params.validate()?;
    let mut database = Database::open_read_only_measurement(Path::new(&args[1]))?;
    let snapshot = execution_trace::export(&mut database, &params)?;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut output = options.open(&args[3])?;
    output.write_all(&serde_json::to_vec_pretty(&snapshot)?)?;
    output.write_all(b"\n")?;
    println!(
        "{}",
        serde_json::json!({"status":"exported", "factsDigest":snapshot["factsDigest"],
        "coverage":snapshot["coverage"], "mode":"read_only_no_migration_no_workers"})
    );
    Ok(())
}

#[cfg(not(feature = "slow-tests"))]
fn main() {
    eprintln!("Build with --features slow-tests to enable the read-only metadata exporter.");
    std::process::exit(2);
}
