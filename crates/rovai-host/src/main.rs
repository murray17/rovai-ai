fn main() -> anyhow::Result<()> {
    #[cfg(windows)]
    if rovai_core::managed_process::run_account_helper_if_requested()? {
        return Ok(());
    }
    rovai_host::run_host()
}
