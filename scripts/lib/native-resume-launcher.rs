// Native CreateProcess entry point for the transparent acceptance recorder.
// Every CLI response, including --version, comes from the actual installed CLI.
use std::os::windows::process::CommandExt;
use std::{
    env, fs,
    path::PathBuf,
    process::{Command, Stdio},
};
fn main() {
    let canonical = env::current_exe().expect("launcher path");
    // Node's CommonJS entry resolver rejects Win32 verbatim paths.
    let spelling = canonical.to_string_lossy();
    let ordinary = spelling.strip_prefix(r"\\?\").unwrap_or(&spelling);
    let exe = PathBuf::from(ordinary);
    let root = exe.parent().expect("launcher parent");
    let node = fs::read_to_string(root.join("node-path.txt")).expect("explicit Node path");
    let status = Command::new(node.trim())
        .arg(root.join("proxy.mjs"))
        .args(env::args_os().skip(1))
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .creation_flags(0x08000000)
        .status()
        .expect("start recorder");
    std::process::exit(status.code().unwrap_or(1));
}
