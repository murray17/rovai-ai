use anyhow::{Context, Result, ensure};
use clap::{Parser, Subcommand};
use rovai_core::{application::CoreConfig, storage_layout::ServerPaths};
use std::{
    io::{self, IsTerminal, Write},
    net::SocketAddr,
    path::PathBuf,
};

#[derive(Parser)]
#[command(
    name = "rovai-server",
    version,
    about = "Run the shared Rovai Host with one standalone data root"
)]
struct Cli {
    /// All Rovai-owned Server data. Defaults to ~/.rovai-server, independently of cwd.
    #[arg(long, global = true)]
    data_dir: Option<PathBuf>,
    #[arg(long, default_value = "127.0.0.1:8767")]
    listen: SocketAddr,
    #[arg(long)]
    public_origin: Option<String>,
    /// Explicitly allow unencrypted LAN HTTP; use HTTPS/VPN on untrusted networks.
    #[arg(long)]
    allow_insecure_lan: bool,
    /// Developer-only override. Installed packages locate their matching WebUI automatically.
    #[arg(long, hide = true)]
    web_ui: Option<PathBuf>,
    /// Mirror diagnostic logs to the terminal as well as the data-root log file.
    #[arg(long)]
    verbose: bool,
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    #[command(hide = true)]
    UpdateHelper { plan: PathBuf },
    /// Print the stored management token. Treat stdout as a secret.
    Token,
    /// Show resolved data paths without starting Core or opening a database.
    Paths,
}

pub fn run() -> Result<()> {
    let cli = Cli::parse();
    if let Some(Command::UpdateHelper { plan }) = cli.command {
        return super::server_updates::ServerUpdates::helper(plan);
    }
    let home = dirs::home_dir().context("Current account's Home is unavailable")?;
    let default_root = home.join(".rovai-server");
    let data_dir = cli.data_dir.unwrap_or_else(|| default_root.clone());
    if data_dir == default_root && !default_root.join("rovai.sqlite").try_exists()? {
        ensure!(
            !home.join(".rovai/server/rovai.sqlite").try_exists()?,
            "server_legacy_layout: previous preview data exists at ~/.rovai/server. No empty default instance was created. Keep its original Host invocation until the complete instance is migrated."
        );
    }
    if matches!(cli.command, Some(Command::Paths)) {
        println!(
            "{}",
            serde_json::to_string_pretty(&ServerPaths::from_data_dir(&data_dir)?)?
        );
        return Ok(());
    }
    // Resolve packaged resources before creating data. A missing WebUI should
    // report a broken installation, not leave a new empty business instance.
    let web_ui = if matches!(cli.command, Some(Command::Token)) {
        None
    } else {
        let directory = match cli.web_ui {
            Some(directory) => directory,
            None => std::fs::canonicalize(std::env::current_exe()?)?
                .parent()
                .context("Server executable has no directory")?
                .join("web-ui"),
        };
        let directory = std::fs::canonicalize(directory)
            .context("Matching WebUI is missing; reinstall the complete Server package")?;
        ensure!(
            directory.join("index.html").is_file(),
            "Matching WebUI is missing index.html; reinstall the complete Server package"
        );
        Some(directory)
    };
    let paths = ServerPaths::prepare(&data_dir)?;
    let token = match rovai_web::stored_administrator_token(&paths.data_dir)? {
        Some(token) => token,
        None => paths.management_token(rovai_web::new_token)?,
    };
    if matches!(cli.command, Some(Command::Token)) {
        println!("{token}");
        return Ok(());
    }
    let log_path = paths.logs.join("server.log");
    // Other Server instances may share these program files with separate data
    // roots. An updater cannot replace a portable directory while they use it.
    let running_program = std::fs::File::open(std::env::current_exe()?)?;
    running_program
        .try_lock_shared()
        .context("Server program is being updated; retry startup")?;
    let mut restart_arguments = vec![
        "--data-dir".into(),
        paths.data_dir.to_string_lossy().into_owned(),
        "--listen".into(),
        cli.listen.to_string(),
    ];
    if let Some(origin) = &cli.public_origin {
        restart_arguments.extend(["--public-origin".into(), origin.clone()]);
    }
    if cli.allow_insecure_lan {
        restart_arguments.push("--allow-insecure-lan".into());
    }
    if cli.verbose {
        restart_arguments.push("--verbose".into());
    }
    let updates = super::server_updates::ServerUpdates::new(&paths.data_dir, restart_arguments)?;
    let console = Console::new(
        paths.data_dir.clone(),
        log_path.clone(),
        cli.listen,
        cli.public_origin.is_some(),
    );
    let diagnostics = super::server_logs::Capture::start(paths.open_log()?, cli.verbose)?;
    let require_existing_authority = paths.database.try_exists()?
        || paths
            .runtime_camp_files_root
            .join(".runtime-camp-files-root.json")
            .try_exists()?;
    let config = CoreConfig {
        data_dir: paths.data_dir,
        skill_library_root: paths.skill_library_root,
        runtime_camp_files_root: paths.runtime_camp_files_root,
        mcp_config_path: Some(paths.mcp_config_path),
        require_existing_authority,
        automation_scheduler_control: None,
        removed_skill_project_roots: Default::default(),
    };
    let result = super::run(
        config,
        Some((
            rovai_web::WebConfig {
                listen: cli.listen,
                public_origin: cli.public_origin,
                allow_insecure_lan: cli.allow_insecure_lan,
                ui_directory: web_ui.context("WebUI was not resolved")?,
            },
            token,
        )),
        false,
        Some(&console),
        Some(updates.clone()),
    );
    if let Err(error) = &result {
        // Detailed failures stay in the diagnostic stream; the token is never
        // included in configuration Debug output or this error chain.
        eprintln!("Server failed: {error:#}");
    }
    let drained = diagnostics.finish();
    let result = result.and(drained);
    drop(running_program);
    updates.finish(result.is_ok())?;
    match result {
        Ok(()) => {
            console.line("Rovai Server stopped.");
            Ok(())
        }
        Err(error) => Err(anyhow::anyhow!(
            "{} · logs: {}",
            short_error(&error),
            log_path.display()
        )),
    }
}

/// Human output bypasses stderr/file diagnostics, including in verbose mode.
/// A redirected stdout or noninteractive stdin never receives startup credentials.
pub(crate) struct Console {
    interactive: bool,
    color: bool,
    data: PathBuf,
    log: PathBuf,
    listen: SocketAddr,
    proxy: bool,
}

impl Console {
    fn new(data: PathBuf, log: PathBuf, listen: SocketAddr, proxy: bool) -> Self {
        let interactive = io::stdin().is_terminal() && io::stdout().is_terminal();
        Self {
            interactive,
            color: terminal_color()
                && std::env::var_os("NO_COLOR").is_none()
                && std::env::var("TERM").as_deref() != Ok("dumb"),
            data,
            log,
            listen,
            proxy,
        }
    }

    pub(crate) fn ready(&self, status: &serde_json::Value, token: &str) {
        let heading = format!("Rovai Server {} · Ready", env!("CARGO_PKG_VERSION"));
        let mut lines = vec![if self.color {
            format!("\x1b[1;32m{heading}\x1b[0m")
        } else {
            heading
        }];
        if let Some(addresses) = status["addresses"].as_array() {
            for address in addresses {
                if let Some(origin) = address["origin"].as_str() {
                    lines.push(format!("  Address  {origin}"));
                }
            }
        }
        let scope = if self.listen.ip().is_loopback() {
            "this computer"
        } else {
            "network interfaces (HTTP)"
        };
        lines.push(format!(
            "  Access   {scope}{}; Owner login required",
            if self.proxy {
                " + configured proxy"
            } else {
                ""
            }
        ));
        lines.push(format!("  Data     {}", self.data.display()));
        lines.push(format!("  Logs     {}", self.log.display()));
        if self.interactive {
            lines.push(format!("  Token    {token}"));
        } else {
            lines.push(
                "  Token    available with rovai-server --data-dir <same-directory> token".into(),
            );
        }
        lines.push("  Foreground · Ctrl-C to stop · --verbose for terminal diagnostics".into());
        self.line(&lines.join("\n"));
    }

    pub(crate) fn line(&self, message: &str) {
        // Closing a terminal must not turn successful durable shutdown into a
        // panic because the human output stream has gone away.
        let mut output = io::stdout().lock();
        let _ = writeln!(output, "{message}");
        let _ = output.flush();
    }
}

fn short_error(error: &anyhow::Error) -> String {
    let message = error.to_string();
    if let Some(code) = message
        .strip_prefix("Core authority is unavailable: ")
        .and_then(|frame| serde_json::from_str::<serde_json::Value>(frame).ok())
        .and_then(|frame| frame["error"]["code"].as_str().map(str::to_owned))
    {
        return format!("Core startup refused ({code})");
    }
    message
        .lines()
        .next()
        .unwrap_or("Server operation failed")
        .chars()
        .take(240)
        .collect()
}

fn terminal_color() -> bool {
    if !io::stdout().is_terminal() {
        return false;
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Console::{
            ENABLE_VIRTUAL_TERMINAL_PROCESSING, GetConsoleMode, GetStdHandle, STD_OUTPUT_HANDLE,
            SetConsoleMode,
        };
        // The handle is borrowed from the process and remains owned by stdout.
        let handle = unsafe { GetStdHandle(STD_OUTPUT_HANDLE) };
        let mut mode = 0;
        return unsafe {
            GetConsoleMode(handle, &mut mode) != 0
                && SetConsoleMode(handle, mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING) != 0
        };
    }
    #[cfg(not(windows))]
    true
}
