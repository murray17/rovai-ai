use anyhow::{Context, Result};

#[cfg(unix)]
pub struct StopSignals {
    interrupt: tokio::signal::unix::Signal,
    terminate: tokio::signal::unix::Signal,
}

#[cfg(unix)]
impl StopSignals {
    pub fn register() -> Result<Self> {
        use tokio::signal::unix::{SignalKind, signal};
        Ok(Self {
            interrupt: signal(SignalKind::interrupt()).context("register SIGINT")?,
            terminate: signal(SignalKind::terminate()).context("register SIGTERM")?,
        })
    }

    pub async fn wait(mut self) -> Result<()> {
        tokio::select! {
            event = self.interrupt.recv() => event.context("SIGINT listener closed"),
            event = self.terminate.recv() => event.context("SIGTERM listener closed"),
        }
    }
}

#[cfg(windows)]
pub struct StopSignals {
    interrupt: tokio::signal::windows::CtrlC,
    break_signal: tokio::signal::windows::CtrlBreak,
}

#[cfg(windows)]
impl StopSignals {
    pub fn register() -> Result<Self> {
        use tokio::signal::windows::{ctrl_break, ctrl_c};
        Ok(Self {
            interrupt: ctrl_c().context("register Ctrl-C")?,
            break_signal: ctrl_break().context("register Ctrl-Break")?,
        })
    }

    pub async fn wait(mut self) -> Result<()> {
        tokio::select! {
            event = self.interrupt.recv() => event.context("Ctrl-C listener closed"),
            event = self.break_signal.recv() => event.context("Ctrl-Break listener closed"),
        }
    }
}
