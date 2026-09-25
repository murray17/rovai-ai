//! Server-owned update state. The browser can select an action, never a URL or filesystem path.
mod install;
#[cfg(test)]
mod tests;
use anyhow::{Context, Result, bail, ensure};
use chrono::Utc;
use rovai_web::{UpdateFuture, UpdateHost, UpdateRequest};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::{io::AsyncWriteExt, sync::Notify};

const CHANNEL: &str =
    "https://raw.githubusercontent.com/murray17/rovai-ai/main/scripts/server-channel.txt";
const RELEASES: &str = "https://github.com/murray17/rovai-ai/releases/download";
const API: &str = "https://api.github.com/repos/murray17/rovai-ai/releases/tags";
const MAX_ARCHIVE: u64 = 1024 * 1024 * 1024;

#[derive(Clone)]
pub(crate) struct ServerUpdates(Arc<Inner>);
struct Inner {
    state: Mutex<State>,
    stop: Notify,
    root: PathBuf,
    data: PathBuf,
    arguments: Vec<String>,
    sources: Sources,
}
struct Sources {
    channel: String,
    releases: String,
    api: String,
}
struct State {
    snapshot: Value,
    release: Option<Release>,
    prepared: Option<install::Prepared>,
    handoff: Option<install::Handoff>,
}
#[derive(Clone)]
struct Release {
    version: String,
    size: u64,
}

impl ServerUpdates {
    pub(crate) fn new(data: &Path, arguments: Vec<String>) -> Result<Self> {
        let root = std::env::current_exe()?
            .parent()
            .context("Server executable directory")?
            .to_owned();
        let failed_install = data.join("updates/last-failure.txt").is_file();
        Ok(Self(Arc::new(Inner {
            state: Mutex::new(State {
                snapshot: json!({
                    "currentVersion": env!("CARGO_PKG_VERSION"), "status": if failed_install { "check_failed" } else { "idle" },
                    "currentRelease":null, "availableRelease":null,
                    "lastCheckSource":null,"checkedAt":null,"lastSuccessfulCheckAt":null,
                    "downloadPercent":null,"transferredBytes":null,"totalBytes":null,"bytesPerSecond":null,
                    "failureReason": if failed_install { json!("install_failed") } else { Value::Null },"pendingPrompt":null
                }),
                release: None,
                prepared: None,
                handoff: None,
            }),
            stop: Notify::new(),
            root,
            data: data.to_owned(),
            arguments,
            sources: Sources {
                channel: CHANNEL.into(),
                releases: RELEASES.into(),
                api: API.into(),
            },
        })))
    }
    fn snapshot(&self) -> Value {
        self.0.state.lock().unwrap().snapshot.clone()
    }
    fn failure(&self, stage: &str, reason: &str) {
        let mut state = self.0.state.lock().unwrap();
        state.snapshot["status"] = json!(format!("{stage}_failed"));
        state.snapshot["failureReason"] = json!(reason);
    }
    pub(crate) async fn requested(&self) {
        self.0.stop.notified().await;
        // Give the accepted HTTP response a chance to leave before closing the listener.
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
    pub(crate) fn finish(&self, settled: bool) -> Result<()> {
        if let Some(handoff) = self.0.state.lock().unwrap().handoff.take() {
            handoff.finish(settled)?;
        }
        Ok(())
    }
    pub(crate) fn helper(path: PathBuf) -> Result<()> {
        install::helper(path)
    }

    fn begin_check(&self, state: &mut State, source: &str) {
        state.snapshot["status"] = json!("checking");
        state.snapshot["failureReason"] = Value::Null;
        state.snapshot["lastCheckSource"] = json!(source);
        state.snapshot["checkedAt"] = json!(Utc::now().to_rfc3339());
        let service = self.clone();
        tokio::spawn(async move {
            if let Err(error) = service.check().await {
                let reason = if error.downcast_ref::<reqwest::Error>().is_some() {
                    "network"
                } else {
                    "invalid_release"
                };
                tracing::warn!("Server update check failed: {error}");
                service.failure("check", reason);
            }
        });
    }
    pub(crate) fn start_automatic_checks(&self) {
        let service = self.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(10)).await;
            let mut source = "startup";
            loop {
                {
                    let mut state = service.0.state.lock().unwrap();
                    if !matches!(
                        state.snapshot["status"].as_str(),
                        Some(
                            "checking"
                                | "downloading"
                                | "ready_to_install"
                                | "installing"
                                | "install_failed"
                        )
                    ) {
                        service.begin_check(&mut state, source);
                    }
                }
                source = "interval";
                tokio::time::sleep(Duration::from_secs(6 * 60 * 60)).await;
            }
        });
    }

    async fn check(&self) -> Result<()> {
        let client = client()?;
        let channel = bounded(&client, &self.0.sources.channel, 128).await?;
        let version = std::str::from_utf8(&channel)?.trim();
        if version == "unpublished" {
            self.failure("check", "release_unpublished");
            return Ok(());
        }
        let coordinates = version_numbers(version).context("invalid_release")?;
        let response = bounded(
            &client,
            &format!("{}/server-v{version}", self.0.sources.api),
            2 * 1024 * 1024,
        )
        .await?;
        let release: Value = serde_json::from_slice(&response)?;
        ensure!(
            release["draft"] == false
                && release["prerelease"] == false
                && release["tag_name"] == format!("server-v{version}"),
            "invalid_release"
        );
        let target = target().context("updater_unavailable")?;
        let asset = asset_name(version, target);
        let assets = release["assets"].as_array().context("invalid_release")?;
        let matches: Vec<_> = assets.iter().filter(|item| item["name"] == asset).collect();
        ensure!(
            matches.len() == 1
                && assets
                    .iter()
                    .filter(|item| item["name"] == "SHA256SUMS")
                    .count()
                    == 1,
            "invalid_release"
        );
        let size = matches[0]["size"].as_u64().context("invalid_release")?;
        ensure!(size > 0 && size <= MAX_ARCHIVE, "invalid_release");
        let mut state = self.0.state.lock().unwrap();
        let now = Utc::now().to_rfc3339();
        let current =
            version_numbers(env!("CARGO_PKG_VERSION")).context("invalid current version")?;
        let available = coordinates > current;
        let release_info = json!({"version":version,
            "releaseName": release["name"].as_str().map(|v| v.chars().take(500).collect::<String>()),
            "releaseDate": release["published_at"].as_str(),
            "releaseNotes": release["body"].as_str().map(|v| v.chars().take(100_000).collect::<String>())});
        state.snapshot["status"] = json!(if available { "available" } else { "up_to_date" });
        state.snapshot["lastSuccessfulCheckAt"] = json!(now);
        state.snapshot["failureReason"] = Value::Null;
        if available {
            state.snapshot["availableRelease"] = release_info;
        } else {
            state.snapshot["availableRelease"] = Value::Null;
            if coordinates == current {
                state.snapshot["currentRelease"] = release_info;
            }
        }
        state.release = available.then(|| Release {
            version: version.into(),
            size,
        });
        let _ = std::fs::remove_file(self.0.data.join("updates/last-failure.txt"));
        Ok(())
    }
    async fn download(&self, release: Release) -> Result<()> {
        let target = target().context("unsupported platform")?;
        let name = asset_name(&release.version, target);
        let directory = self.0.data.join("updates").join(rovai_web::new_token()?);
        rovai_core::platform::prepare_private_directory(&directory)?;
        let result = async {
            let client = client()?;
            let base = format!("{}/server-v{}", self.0.sources.releases, release.version);
            let checksums = bounded(&client, &format!("{base}/SHA256SUMS"), 1024 * 1024).await?;
            let digest = checksum(std::str::from_utf8(&checksums)?, &name)?;
            tokio::fs::write(directory.join("SHA256SUMS"), &checksums).await?;
            let mut response = client
                .get(format!("{base}/{name}"))
                .send()
                .await?
                .error_for_status()?;
            if let Some(length) = response.content_length() {
                ensure!(length == release.size, "archive length mismatch");
            }
            let mut file = tokio::fs::File::create(directory.join(&name)).await?;
            let mut hash = Sha256::new();
            let start = Instant::now();
            let mut total = 0u64;
            while let Some(bytes) = response.chunk().await? {
                total += bytes.len() as u64;
                ensure!(total <= release.size, "archive exceeds declared size");
                file.write_all(&bytes).await?;
                hash.update(&bytes);
                let mut state = self.0.state.lock().unwrap();
                state.snapshot["transferredBytes"] = json!(total);
                state.snapshot["downloadPercent"] =
                    json!(100.0 * total as f64 / release.size as f64);
                state.snapshot["bytesPerSecond"] =
                    json!(total as f64 / start.elapsed().as_secs_f64().max(0.001));
            }
            file.sync_all().await?;
            drop(file);
            ensure!(
                total == release.size && format!("{:x}", hash.finalize()) == digest,
                "archive checksum mismatch"
            );
            let root = self.0.root.clone();
            let arguments = self.0.arguments.clone();
            let data = self.0.data.clone();
            let staging = directory.clone();
            let prepared = tokio::task::spawn_blocking(move || {
                install::prepare(
                    &root,
                    &data,
                    &staging,
                    &release.version,
                    target,
                    &digest,
                    arguments,
                )
            })
            .await??;
            let mut state = self.0.state.lock().unwrap();
            if let Some(previous) = state.prepared.replace(prepared) {
                previous.discard();
            }
            state.snapshot["status"] = json!("ready_to_install");
            Ok::<_, anyhow::Error>(())
        }
        .await;
        if result.is_err() {
            let _ = tokio::fs::remove_dir_all(&directory).await;
        }
        result
    }
}

impl UpdateHost for ServerUpdates {
    fn call(&self, request: UpdateRequest) -> UpdateFuture<'_> {
        Box::pin(async move {
            if matches!(request, UpdateRequest::Get {}) {
                return Ok(self.snapshot());
            }
            let mut state = self.0.state.lock().unwrap();
            let status = state.snapshot["status"].as_str().unwrap_or("idle");
            if matches!(status, "checking" | "downloading" | "installing") {
                return Ok(state.snapshot.clone());
            }
            match request {
                UpdateRequest::Check {} => {
                    if status == "ready_to_install" {
                        return Ok(state.snapshot.clone());
                    }
                    self.begin_check(&mut state, "manual");
                }
                UpdateRequest::Download { version } => {
                    if !matches!(status, "available" | "download_failed") {
                        return Err("update_not_available");
                    }
                    let release = state
                        .release
                        .clone()
                        .filter(|r| r.version == version)
                        .ok_or("update_version_changed")?;
                    state.snapshot["status"] = json!("downloading");
                    state.snapshot["failureReason"] = Value::Null;
                    state.snapshot["transferredBytes"] = json!(0);
                    state.snapshot["downloadPercent"] = json!(0);
                    state.snapshot["totalBytes"] = json!(release.size);
                    let service = self.clone();
                    tokio::spawn(async move {
                        if let Err(error) = service.download(release).await {
                            tracing::warn!("Server update download failed: {error}");
                            service.failure("download", "download_failed");
                        }
                    });
                }
                UpdateRequest::Install { version } => {
                    if !matches!(status, "ready_to_install" | "install_failed") {
                        return Err("update_not_ready");
                    }
                    let prepared = state
                        .prepared
                        .as_ref()
                        .filter(|p| p.version() == version)
                        .ok_or("update_not_ready")?;
                    match prepared.handoff() {
                        Ok(handoff) => {
                            state.handoff = Some(handoff);
                            state.snapshot["status"] = json!("installing");
                            self.0.stop.notify_one();
                        }
                        Err(error) => {
                            tracing::warn!("Server update preparation failed: {error}");
                            state.snapshot["status"] = json!("install_failed");
                            state.snapshot["failureReason"] = json!("install_failed");
                        }
                    }
                }
                UpdateRequest::Get {} => unreachable!(),
            }
            Ok(state.snapshot.clone())
        })
    }
}

fn client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .https_only(!cfg!(test))
        .user_agent("Rovai-Server-Updater")
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(600))
        .build()?)
}
async fn bounded(client: &reqwest::Client, url: &str, limit: usize) -> Result<Vec<u8>> {
    let mut response = client.get(url).send().await?.error_for_status()?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        ensure!(
            bytes.len() + chunk.len() <= limit,
            "release metadata too large"
        );
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
fn version_numbers(value: &str) -> Option<[u64; 3]> {
    let parts = value
        .split('.')
        .map(|part| {
            if part.is_empty()
                || (part.len() > 1 && part.starts_with('0'))
                || !part.bytes().all(|b| b.is_ascii_digit())
            {
                None
            } else {
                part.parse().ok()
            }
        })
        .collect::<Option<Vec<_>>>()?;
    parts.try_into().ok()
}
fn checksum(text: &str, name: &str) -> Result<String> {
    let matches: Vec<_> = text
        .lines()
        .filter_map(|line| {
            let parts: Vec<_> = line.split_whitespace().collect();
            (parts.len() == 2 && parts[1] == name).then(|| parts[0])
        })
        .collect();
    ensure!(matches.len() == 1, "missing or duplicate checksum");
    let digest = matches[0];
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        bail!("invalid checksum");
    }
    Ok(digest.to_owned())
}
fn target() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Some("macos-arm64"),
        ("macos", "x86_64") => Some("macos-x64"),
        ("linux", "x86_64") => Some("linux-x64"),
        ("windows", "x86_64") => Some("windows-x64"),
        _ => None,
    }
}
fn asset_name(version: &str, target: &str) -> String {
    format!(
        "rovai-server-{version}-{target}.{}",
        if target == "windows-x64" {
            "zip"
        } else {
            "tar.gz"
        }
    )
}
