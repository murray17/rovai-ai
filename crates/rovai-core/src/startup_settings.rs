//! Owner-only startup editor. Draft probes do not publish product readiness.
use crate::application::{
    Core, IdentityCheckedProbe, RUNTIME_CHECK_TOTAL_DEADLINE, RuntimeCheckOutcome,
    RuntimeCheckRequest, RuntimeCheckTrigger, RuntimeDiscoveryStatus, RuntimeLaunchPurpose,
    current_runtime_platform_blocker, discover_runtime_path, discover_runtime_version,
    run_identity_checked_probe, with_runtime_configuration,
};
use anyhow::{Context, Result, ensure};
use rovai_core::{
    agent_profile::{AdapterKind, AgentProfileService, InstallationSource},
    runtime_startup::{self, RuntimeStartupConfiguration},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{path::PathBuf, sync::Arc, time::Duration};
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
    #[serde(default)]
    edits: Option<Vec<runtime_startup::FieldEdit>>,
    #[serde(default)]
    configuration: Option<RuntimeStartupConfiguration>,
    #[serde(default)]
    expected_revision: Option<u64>,
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
                if settings.revision == 0 && settings.configuration.program_path.is_none() {
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
                Ok(serde_json::to_value(runtime_startup::public(settings))?)
            }
            "runtime.startup.inspect" | "runtime.startup.check" => {
                let params: DraftParams = serde_json::from_value(params)
                    .map_err(|_| anyhow::anyhow!("启动设置输入格式无效。"))?;
                let configuration = runtime_startup::resolve_draft(
                    &*self.database.lock().await,
                    params.runtime_kind,
                    params.configuration,
                )?;
                if method == "runtime.startup.check" {
                    self.check_runtime_startup(params.runtime_kind, configuration)
                        .await
                } else {
                    self.inspect_runtime_startup(params.runtime_kind, configuration, false)
                        .await
                }
            }
            "runtime.startup.save" => {
                let params: SaveParams = serde_json::from_value(params)
                    .map_err(|_| anyhow::anyhow!("启动设置输入格式无效。"))?;
                let _update = self.runtime_search_update.lock().await;
                self.save_runtime_startup(params).await
            }
            _ => anyhow::bail!("Unknown startup settings method"),
        }
    }

    async fn save_runtime_startup(&self, params: SaveParams) -> Result<Value> {
        let kind = params.runtime_kind;
        ensure!(
            current_runtime_platform_blocker(kind).is_none(),
            "当前平台不支持这个运行时。"
        );
        let initial_legacy_save = params.configuration.is_some();
        let edits = match (params.edits, params.configuration, params.expected_revision) {
            (Some(edits), None, None) => edits,
            (None, Some(configuration), Some(revision)) => {
                let saved = runtime_startup::load(&*self.database.lock().await, kind)?;
                let same = saved.configuration.program_path == configuration.program_path
                    && saved.configuration.environment == configuration.environment;
                if same && saved.revision > 0 {
                    return Ok(serde_json::to_value(runtime_startup::saved_response(
                        saved,
                    ))?);
                }
                ensure!(
                    saved.revision == revision,
                    "启动设置已被更新，请保留草稿并再次保存。"
                );
                runtime_startup::ordinary_edits(kind, &saved.configuration, &configuration)
            }
            _ => anyhow::bail!("启动设置保存格式无效。"),
        };
        let prepared = runtime_startup::prepare_save(&*self.database.lock().await, kind, edits)?;
        if !prepared.conflicts.is_empty() {
            return Ok(
                json!({"status":"conflict", "latest":runtime_startup::saved_response(prepared.current), "conflicts":prepared.conflicts}),
            );
        }
        if prepared.edits.is_empty() && !(initial_legacy_save && prepared.current.revision == 0) {
            return Ok(serde_json::to_value(runtime_startup::saved_response(
                prepared.current,
            ))?);
        }
        // Saving only publishes local configuration. Retain the captured
        // PATH; discovery, shell reads and native commands belong to their
        // explicit operations, never this transaction.
        let current = self.runtime_search_environment.read().await.clone();
        let search = current.as_ref().clone().with_generation(
            current
                .generation()
                .checked_add(1)
                .context("Runtime generation exhausted")?,
        );
        if prepared
            .edits
            .iter()
            .any(|edit| edit.path == ["programPath"])
            && let Some(path) = &prepared.configuration.program_path
        {
            ensure!(
                rovai_core::runtime_discovery::is_runtime_entrypoint_file(std::path::Path::new(
                    path
                )),
                "所选程序不存在或无法执行，请重新选择。"
            );
        }
        let settings = {
            let mut database = self.database.lock().await;
            runtime_startup::commit_save(&mut database, kind, prepared, search.generation())?
        };
        let search = if settings.reconnect_required {
            search
        } else {
            search.with_generation(self.runtime_search_environment.read().await.generation())
        }
        .with_startup_configuration(kind, settings.configuration.clone());
        search.activate_for_runtime_commands();
        *self.runtime_search_environment.write().await = Arc::new(search);
        if settings.reconnect_required {
            self.native_skill_discovery.invalidate_cache();
        }
        // No fleet invalidation: a live host retains its captured process environment.
        Ok(serde_json::to_value(runtime_startup::saved_response(
            settings,
        ))?)
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
            .read_runtime_check_environment(true)
            .await?
            .with_startup_configuration(kind, configuration);
        let path_search = search.clone();
        let mut observation =
            tokio::task::spawn_blocking(move || discover_runtime_path(kind, &path_search)).await?;
        if observation.discovery_status != RuntimeDiscoveryStatus::Found {
            return Ok(
                json!({"status": "missing", "executablePath": null, "reportedVersion": null,
                    "searchEnvironment": search.summary()}),
            );
        }
        let path = PathBuf::from(
            observation
                .executable_path
                .as_deref()
                .context("Runtime path missing")?,
        );
        let expected_fingerprint = observation.executable_fingerprint.clone();
        let locator = observation.entrypoint_locator_identity.clone();
        let candidate_is_current = || {
            rovai_core::agent_runtime_adapter::executable_fingerprint(&path).ok()
                == expected_fingerprint
                && search
                    .candidates(kind, std::iter::empty())
                    .iter()
                    .any(|candidate| {
                        candidate.entrypoint_locator_identity == locator
                            && crate::application::canonical_runtime_path(&candidate.path)
                                == crate::application::canonical_runtime_path(&path)
                            && candidate.entrypoint_locator_identity_is_current()
                    })
        };
        ensure!(
            candidate_is_current(),
            "程序在检查期间发生变化，请重新检查。"
        );
        let status = if deep {
            // The adapter's own version + protocol/auth check is one identity-fenced
            // probe. Do not mix an earlier standalone --version with a later binary.
            let checked = run_identity_checked_probe(
                &path,
                with_runtime_configuration(
                    kind,
                    &search,
                    self.deep_probe_candidate(kind, &path, RuntimeLaunchPurpose::AvailabilityCheck),
                ),
            )
            .await;
            ensure!(
                candidate_is_current(),
                "程序在检查期间发生变化，请重新检查。"
            );
            let probe = match checked {
                IdentityCheckedProbe::Stable(probe) => probe,
                IdentityCheckedProbe::Superseded => {
                    anyhow::bail!("程序在检查期间发生变化，请重新检查。")
                }
            };
            // Keep raw provider errors, credentials, catalog and configuration out of this response.
            observation.reported_version = probe
                .as_ref()
                .ok()
                .and_then(|probe| probe.snapshot.reported_version.clone());
            match probe {
                Ok(probe)
                    if probe.snapshot.authentication_status == "authentication_required"
                        || probe.snapshot.probe_status == "authentication_required" =>
                {
                    "authentication_required"
                }
                Ok(probe) if probe.snapshot.probe_status == "ready" => "ready",
                _ => "check_failed",
            }
        } else {
            discover_runtime_version(&mut observation, &search).await;
            ensure!(
                candidate_is_current(),
                "程序在检查期间发生变化，请重新检查。"
            );
            if observation.version_probe_succeeded == Some(true) {
                "recognized"
            } else {
                "version_unverified"
            }
        };
        Ok(
            json!({"status": status, "executablePath": observation.executable_path,
            "reportedVersion": observation.reported_version, "searchEnvironment": search.summary()}),
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
                search: self.runtime_search_environment.read().await.clone(),
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
