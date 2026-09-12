//! Owner-only startup editor. Draft probes do not publish product readiness.
use crate::{
    Core, RUNTIME_CHECK_TOTAL_DEADLINE, RuntimeCheckOutcome, RuntimeCheckRequest,
    RuntimeCheckTrigger, RuntimeDiscoveryStatus, RuntimeLaunchPurpose,
    current_runtime_platform_blocker, discover_runtime_path, discover_runtime_version,
    with_runtime_configuration,
};
use anyhow::{Context, Result, ensure};
use rovai_core::{
    agent_profile::{AdapterKind, AgentProfileService, InstallationSource},
    runtime_startup::{self, RuntimeStartupConfiguration},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{path::Path, sync::Arc, time::Duration};
use tokio::sync::{Mutex, oneshot};

pub(crate) struct StartupPreview {
    pub configuration: RuntimeStartupConfiguration,
    pub result: Mutex<Option<Value>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct KindParams {
    runtime_kind: AdapterKind,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DraftParams {
    runtime_kind: AdapterKind,
    configuration: RuntimeStartupConfiguration,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveParams {
    runtime_kind: AdapterKind,
    expected_revision: u64,
    configuration: RuntimeStartupConfiguration,
}

impl Core {
    pub(crate) async fn handle_runtime_startup(
        &self,
        method: &str,
        params: Value,
    ) -> Result<Value> {
        match method {
            "runtime.startup.get" => {
                let params: KindParams = serde_json::from_value(params)?;
                let database = self.database.lock().await;
                let mut settings = runtime_startup::load(&database, params.runtime_kind)?;
                // Present legacy explicit installations as the current preference until
                // the first edit. Restoring automatic discovery then becomes explicit.
                if settings.revision == 0 {
                    let service = AgentProfileService::default();
                    if let Some(installation) = service
                        .managed_installation(&database, params.runtime_kind, "default")?
                        .filter(|installation| {
                            matches!(
                                installation.source,
                                InstallationSource::Custom | InstallationSource::Manual
                            )
                        })
                    {
                        settings.configuration.program_path = Some(
                            service
                                .runtime_entrypoint_locator_identity(&database, &installation.id)?
                                .map(|identity| identity.canonical_shim_path)
                                .unwrap_or(installation.executable_path),
                        );
                    }
                }
                Ok(serde_json::to_value(settings)?)
            }
            "runtime.startup.inspect" | "runtime.startup.check" => {
                let params: DraftParams = serde_json::from_value(params)?;
                let configuration = params.configuration.validated(cfg!(windows))?;
                if method == "runtime.startup.check" {
                    self.check_runtime_startup(params.runtime_kind, configuration)
                        .await
                } else {
                    self.inspect_runtime_startup(params.runtime_kind, configuration, false)
                        .await
                }
            }
            "runtime.startup.save" => {
                let params: SaveParams = serde_json::from_value(params)?;
                let kind = params.runtime_kind;
                ensure!(
                    current_runtime_platform_blocker(kind).is_none(),
                    "当前平台不支持这个运行时。"
                );
                let configuration = params.configuration.validated(cfg!(windows))?;
                let _update = self.runtime_search_update.lock().await;
                {
                    let database = self.database.lock().await;
                    let saved = runtime_startup::load(&database, kind)?;
                    if saved.revision > 0 && saved.configuration == configuration {
                        return Ok(serde_json::to_value(saved)?);
                    }
                }
                let current = self.runtime_search_environment.read().await.clone();
                let search = current
                    .as_ref()
                    .clone()
                    .with_generation(
                        current
                            .generation()
                            .checked_add(1)
                            .context("Runtime generation exhausted")?,
                    )
                    .with_startup_configuration(kind, configuration.clone());
                if configuration.program_path.is_some() {
                    let draft_search = search.clone();
                    let observation = tokio::task::spawn_blocking(move || {
                        discover_runtime_path(kind, &draft_search)
                    })
                    .await?;
                    ensure!(
                        observation.discovery_status == RuntimeDiscoveryStatus::Found,
                        "所选程序不存在或无法执行，请重新选择。"
                    );
                }
                let settings = {
                    let mut database = self.database.lock().await;
                    runtime_startup::save(
                        &mut database,
                        kind,
                        params.expected_revision,
                        configuration,
                        search.generation(),
                    )?
                };
                search.activate_for_runtime_commands();
                *self.runtime_search_environment.write().await = Arc::new(search);
                // No fleet invalidation: a live host retains its captured process environment.
                self.run_runtime_discovery().await;
                Ok(serde_json::to_value(settings)?)
            }
            _ => anyhow::bail!("Unknown startup settings method"),
        }
    }

    pub(crate) async fn inspect_runtime_startup(
        &self,
        kind: AdapterKind,
        configuration: RuntimeStartupConfiguration,
        deep: bool,
    ) -> Result<Value> {
        ensure!(
            current_runtime_platform_blocker(kind).is_none(),
            "当前平台不支持这个运行时。"
        );
        let search = self
            .runtime_search_environment
            .read()
            .await
            .as_ref()
            .clone()
            .with_startup_configuration(kind, configuration);
        let path_search = search.clone();
        let mut observation =
            tokio::task::spawn_blocking(move || discover_runtime_path(kind, &path_search)).await?;
        if observation.discovery_status != RuntimeDiscoveryStatus::Found {
            return Ok(
                json!({"status": "missing", "executablePath": null, "reportedVersion": null}),
            );
        }
        discover_runtime_version(&mut observation, &search).await;
        let mut status = if observation.version_probe_succeeded == Some(true) {
            "recognized"
        } else {
            "version_unverified"
        };
        if deep {
            let path = Path::new(
                observation
                    .executable_path
                    .as_deref()
                    .context("Runtime path missing")?,
            );
            let before = rovai_core::agent_runtime_adapter::executable_fingerprint(path)?;
            let probe = with_runtime_configuration(
                kind,
                &search,
                self.deep_probe_candidate(kind, path, RuntimeLaunchPurpose::AvailabilityCheck),
            )
            .await;
            ensure!(
                rovai_core::agent_runtime_adapter::executable_fingerprint(path)
                    .ok()
                    .as_deref()
                    == Some(&before),
                "程序在检查期间发生变化，请重新检查。"
            );
            // Keep raw provider errors, credentials, catalog and configuration out of this response.
            status = match probe {
                Ok(probe)
                    if probe.snapshot.authentication_status == "authentication_required"
                        || probe.snapshot.probe_status == "authentication_required" =>
                {
                    "authentication_required"
                }
                Ok(probe) if probe.snapshot.probe_status == "ready" => "ready",
                _ => "check_failed",
            };
        }
        Ok(
            json!({"status": status, "executablePath": observation.executable_path,
            "reportedVersion": observation.reported_version}),
        )
    }

    async fn check_runtime_startup(
        &self,
        kind: AdapterKind,
        configuration: RuntimeStartupConfiguration,
    ) -> Result<Value> {
        let preview = Arc::new(StartupPreview {
            configuration,
            result: Mutex::new(None),
        });
        let (acknowledged, acknowledgement) = oneshot::channel();
        let (completed, completion) = oneshot::channel();
        self.runtime_check_requests
            .send(RuntimeCheckRequest {
                fast_target: None,
                startup_preview: Some(preview.clone()),
                runtime_kind: kind,
                purpose: RuntimeLaunchPurpose::AvailabilityCheck,
                trigger: RuntimeCheckTrigger::UserCheck,
                acknowledged,
                completion: Some(completed),
            })
            .map_err(|_| anyhow::anyhow!("Runtime check manager is unavailable"))?;
        tokio::time::timeout(Duration::from_secs(2), acknowledgement).await??;
        let outcome = tokio::time::timeout(
            RUNTIME_CHECK_TOTAL_DEADLINE + Duration::from_secs(3),
            completion,
        )
        .await
        .context("检查超时，请重试。")?
        .context("检查已中断，请重试。")?;
        ensure!(
            matches!(
                outcome,
                Ok(RuntimeCheckOutcome::Ready | RuntimeCheckOutcome::StableFailure)
            ),
            "检查未完成，请重试。"
        );
        preview
            .result
            .lock()
            .await
            .take()
            .context("检查未完成，请重试。")
    }
}
