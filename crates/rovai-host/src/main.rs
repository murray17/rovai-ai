mod lifecycle;
mod signals;
mod web_control;

use std::{
    io::{BufRead, Read},
    net::SocketAddr,
    path::PathBuf,
    sync::Arc,
    time::Duration,
};

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
    /// Start one Core owner, optionally with the shared Web module.
    Run(RunArgs),
    /// Generate a management token for an operator. Treat stdout as a secret.
    Token,
    /// Prepare only the explicitly selected private directory and print path arguments.
    Prepare {
        #[arg(long)]
        data_dir: PathBuf,
    },
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
    /// Enable HTTP at this address; loopback is the safe default choice.
    #[arg(long, requires_all = ["web_ui", "web_token_stdin"])]
    web_listen: Option<SocketAddr>,
    /// Absolute directory containing the built shared WebUI.
    #[arg(long, requires = "web_listen")]
    web_ui: Option<PathBuf>,
    /// Exact console origin, required for a LAN listener.
    #[arg(long, requires = "web_listen")]
    web_public_origin: Option<String>,
    /// Explicitly allow unencrypted LAN HTTP; use HTTPS/VPN on untrusted networks.
    #[arg(long, requires = "web_listen")]
    allow_insecure_lan: bool,
    /// Read one 64-character token from stdin. Never put it in args or environment.
    #[arg(long, requires = "web_listen")]
    web_token_stdin: bool,
}

fn main() -> Result<()> {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    // Desktop keeps its existing explicit path/config arguments and parent pipe.
    // The compatibility executable remains available to old integrations.
    let desktop = arguments.first().is_some_and(|argument| {
        argument.starts_with("--") && !matches!(argument.as_str(), "--help" | "--version")
    });
    if arguments
        .first()
        .is_some_and(|argument| argument == "--prepare-windows-data-root")
    {
        return rovai_core::application::run_stdio();
    }
    let mut web = None;
    let config = if desktop {
        CoreConfig::from_legacy_args(arguments)?
    } else {
        match Cli::parse().command {
            Command::Token => {
                println!("{}", rovai_web::new_token()?);
                return Ok(());
            }
            Command::Prepare { data_dir } => {
                anyhow::ensure!(
                    data_dir.is_absolute()
                        && !data_dir.components().any(|part| matches!(
                            part,
                            std::path::Component::CurDir | std::path::Component::ParentDir
                        )),
                    "prepare requires a normalized absolute path"
                );
                anyhow::ensure!(
                    !data_dir.try_exists()?,
                    "prepare requires a new directory; it does not repair or change existing data"
                );
                #[cfg(unix)]
                let data = {
                    use std::os::unix::fs::DirBuilderExt;
                    std::fs::DirBuilder::new()
                        .mode(0o700)
                        .create(&data_dir)
                        .context(
                            "could not create private data directory; its parent must exist",
                        )?;
                    std::fs::canonicalize(&data_dir)?
                };
                #[cfg(not(unix))]
                let data = rovai_core::platform::prepare_private_directory(&data_dir)?;
                let runtime_files = if cfg!(windows) {
                    data.join("runtime-files")
                } else {
                    let home = std::fs::canonicalize(
                        dirs::home_dir().context("current Home is unavailable")?,
                    )?;
                    home.join(".rovai/instances")
                        .join(rovai_core::camp_attachment_view::instance_key(&data)?)
                        .join("runtime-files")
                };
                println!(
                    "{}",
                    serde_json::to_string_pretty(&serde_json::json!({
                        "dataDir": data,
                        "skillLibraryRoot": data.join("skills"),
                        "mcpConfigPath": data.join("mcp.json"),
                        "runtimeCampFilesRoot": runtime_files,
                        "runArguments": ["--data-dir", data.to_str(), "--skill-library-root", data.join("skills").to_str(), "--mcp-config-path", data.join("mcp.json").to_str(), "--runtime-camp-files-root", runtime_files.to_str()]
                    }))?
                );
                return Ok(());
            }
            Command::Run(args) => {
                if let Some(listen) = args.web_listen {
                    let mut token = String::new();
                    std::io::stdin()
                        .lock()
                        .take(66)
                        .read_line(&mut token)
                        .context("could not read Web management token from stdin")?;
                    let token = token.trim_end_matches(['\r', '\n']).to_owned();
                    web = Some((
                        rovai_web::WebConfig {
                            listen,
                            public_origin: args.web_public_origin,
                            allow_insecure_lan: args.allow_insecure_lan,
                            ui_directory: args.web_ui.context("Web UI directory is required")?,
                        },
                        token,
                    ));
                }
                CoreConfig {
                    data_dir: args.data_dir,
                    skill_library_root: args.skill_library_root,
                    runtime_camp_files_root: args.runtime_camp_files_root,
                    mcp_config_path: Some(args.mcp_config_path),
                    require_existing_authority: !args.initialize,
                    automation_scheduler_control: None,
                    removed_skill_project_roots: Default::default(),
                }
            }
        }
    };
    tracing_subscriber::fmt()
        .with_ansi(false)
        .with_target(false)
        .with_writer(std::io::stderr)
        .init();

    // Preserve the Desktop adapter's ordering: discovery captures its search
    // environment before Tokio starts and passes it to child launches explicitly.
    let environment = Arc::new(RuntimeSearchEnvironment::capture_initial());
    environment.activate_for_runtime_commands();
    let (core, runner) = embedded(config, environment)?;
    let control = web_control::WebControl::new(core.clone());
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context("failed to create Host Tokio runtime")?;
    let result = runtime.block_on(async {
        if desktop {
            let result = runner.with_desktop_stdio(control.clone()).run().await;
            control.stop().await;
            return result;
        }
        // Register listeners before starting Core, including during admission.
        let signals = signals::StopSignals::register()?;
        if let Some((config, token)) = web {
            let status = control.start(config, &token).await?;
            tracing::info!(
                origin = status["origin"].as_str().unwrap_or_default(),
                "Host Web listener started"
            );
        }
        let result = lifecycle::run(core, runner, signals.wait()).await;
        control.stop().await;
        result
    });
    // Host owns this runtime. On a hard stop it must also end all remaining Core
    // task owners; it does not leave detached work running in another service.
    runtime.shutdown_timeout(Duration::from_millis(250));
    result
}
