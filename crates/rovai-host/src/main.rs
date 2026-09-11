mod lifecycle;
mod signals;

use std::{path::PathBuf, sync::Arc, time::Duration};

use anyhow::{Context, Result};
use clap::{Args, Parser, Subcommand};
use rovai_core::{
    application::{CoreConfig, embedded},
    runtime_discovery::RuntimeSearchEnvironment,
};

#[derive(Parser)]
#[command(version, about = "Run the shared Rovai Core without Electron")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Start one Core owner. Web and local user IPC are not connected yet.
    Run(RunArgs),
}

#[derive(Args)]
struct RunArgs {
    /// Absolute Core data directory; never inferred from Desktop userData.
    #[arg(long)]
    data_dir: PathBuf,
    /// Absolute Skill Library directory belonging to this Host.
    #[arg(long)]
    skill_library_root: PathBuf,
    /// Absolute Runtime Camp files directory belonging to this Host.
    #[arg(long)]
    runtime_camp_files_root: PathBuf,
    /// Absolute MCP config path; prevents use of the daily global config.
    #[arg(long)]
    mcp_config_path: PathBuf,
    /// Allow initialization only when Core confirms that authority is absent.
    /// Without this flag, missing authority is a startup refusal.
    #[arg(long)]
    initialize: bool,
}

fn main() -> Result<()> {
    let Cli {
        command: Command::Run(args),
    } = Cli::parse();
    tracing_subscriber::fmt()
        .with_ansi(false)
        .with_target(false)
        .with_writer(std::io::stderr)
        .init();

    // Preserve the Desktop adapter's ordering: discovery captures its search
    // environment before Tokio starts and passes it to child launches explicitly.
    let environment = Arc::new(RuntimeSearchEnvironment::capture_initial());
    environment.activate_for_runtime_commands();
    let (core, runner) = embedded(
        CoreConfig {
            data_dir: args.data_dir,
            skill_library_root: args.skill_library_root,
            runtime_camp_files_root: args.runtime_camp_files_root,
            mcp_config_path: Some(args.mcp_config_path),
            require_existing_authority: !args.initialize,
            // The Host clock driver is a separate migration checkpoint. Never
            // advertise Automation/notification parity based on Core readiness.
            automation_scheduler_control: None,
            removed_skill_project_roots: Default::default(),
        },
        environment,
    )?;
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context("failed to create Host Tokio runtime")?;
    let result = runtime.block_on(async {
        // Register listeners before starting Core, including during admission.
        let signals = signals::StopSignals::register()?;
        lifecycle::run(core, runner, signals.wait()).await
    });
    // Host owns this runtime. On a hard stop it must also end all remaining Core
    // task owners; it does not leave detached work running in another service.
    runtime.shutdown_timeout(Duration::from_millis(250));
    result
}
