//! Read-only production Read Side benchmark, never a Core/Runtime startup.
#[cfg(feature = "slow-tests")]
fn main() -> anyhow::Result<()> {
    use rovai_core::{db::Database, read_model::ReadModelService};
    use std::{path::Path, time::Instant};
    let args: Vec<_> = std::env::args().collect();
    anyhow::ensure!(
        args.len() == 3 || (args.len() == 4 && args[3] == "--with-history"),
        "usage: measure_camp_open ABSOLUTE_DB CAMP_ID [--with-history]"
    );
    let mut database = Database::open_read_only_measurement(Path::new(&args[1]))?;
    let mut open_times = Vec::new();
    let mut navigation_times = Vec::new();
    let mut serialization_times = Vec::new();
    let mut history_times = Vec::new();
    let mut history_rows = 0;
    let mut output_bytes = 0;
    // Repetition reports a distribution, not a correctness threshold; first sample stays separate.
    for _ in 0..11 {
        let start = Instant::now();
        let projection = ReadModelService.camp_open_projection(&mut database, &args[2])?;
        open_times.push(start.elapsed().as_secs_f64() * 1000.0);
        let start = Instant::now();
        output_bytes = serde_json::to_vec(&projection)?.len();
        serialization_times.push(start.elapsed().as_secs_f64() * 1000.0);
        let start = Instant::now();
        ReadModelService.navigation_snapshot(&mut database)?;
        navigation_times.push(start.elapsed().as_secs_f64() * 1000.0);
        if args.len() == 3 {
            continue;
        }
        let start = Instant::now();
        history_rows = 0;
        for run in &projection.agent_runs {
            let mut cursor = 0;
            loop {
                let page = ReadModelService.agent_run_execution_evidence_page(
                    &mut database,
                    &args[2],
                    &run.id,
                    cursor,
                    200,
                )?;
                history_rows += page.evidence.len();
                if !page.has_more {
                    break;
                }
                cursor = page.next_after_sequence;
            }
        }
        history_times.push(start.elapsed().as_secs_f64() * 1000.0);
    }
    println!(
        "{}",
        serde_json::json!({"campId":args[2], "openMs":open_times,
        "navigationMs":navigation_times,"serializationMs":serialization_times,"projectionBytes":output_bytes,
        "loadedRunHistoryMs":history_times,"loadedRunHistoryRows":history_rows,
        "scope":"Read Side only; excludes Electron/rendering/lock wait; no data mutation"})
    );
    Ok(())
}

#[cfg(not(feature = "slow-tests"))]
fn main() {
    eprintln!("Build with --features slow-tests to enable the offline measurement tool.");
    std::process::exit(2);
}
