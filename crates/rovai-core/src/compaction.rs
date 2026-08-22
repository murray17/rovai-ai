use std::{collections::BTreeMap, fs, path::Path};

use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    agent_profile::AdapterKind,
    builtin_tool_transport::{
        COMPACTION_OBSERVATION_OUTBOX_SCHEMA_VERSION, CompactionObservationOutboxRecord,
    },
    db::Database,
};

pub const BOOTSTRAP_REDELIVERY_ENVELOPE_VERSION: i64 = 2;
pub const BOOTSTRAP_REDELIVERY_FORMATTER_VERSION: i64 = 2;
pub const BOOTSTRAP_REDELIVERY_POLICY_RELEASE: &str = "v0.48";

const POLICY_ADAPTERS: [AdapterKind; 7] = [
    AdapterKind::CopilotCli,
    AdapterKind::OpencodeCli,
    AdapterKind::KiroCli,
    AdapterKind::QoderCli,
    AdapterKind::CodebuddyCli,
    AdapterKind::QwenCode,
    AdapterKind::AntigravityApp,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompactionDetectorPolicy {
    Disabled,
    BestEffort,
}

impl CompactionDetectorPolicy {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::BestEffort => "best_effort",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value.trim() {
            "disabled" => Some(Self::Disabled),
            "best_effort" => Some(Self::BestEffort),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct DesiredCompactionDetectorPolicies {
    pub policies: BTreeMap<AdapterKind, CompactionDetectorPolicy>,
    pub diagnostics: Vec<String>,
}

impl DesiredCompactionDetectorPolicies {
    /// Reads Rovai-owned, release-level environment switches. Invalid internal
    /// values disable only that detector; they never prevent Core or AgentRun
    /// startup.
    pub fn from_process_environment() -> Self {
        let mut policies = BTreeMap::new();
        let mut diagnostics = Vec::new();
        for adapter_kind in POLICY_ADAPTERS {
            let default = release_default_policy(adapter_kind);
            let key = detector_policy_environment_key(adapter_kind);
            let policy = match std::env::var(key) {
                Ok(value) => match CompactionDetectorPolicy::parse(&value) {
                    Some(CompactionDetectorPolicy::BestEffort)
                        if adapter_kind == AdapterKind::AntigravityApp =>
                    {
                        diagnostics.push(format!(
                            "{key} cannot enable the Antigravity compaction detector in {BOOTSTRAP_REDELIVERY_POLICY_RELEASE}; the detector is disabled"
                        ));
                        CompactionDetectorPolicy::Disabled
                    }
                    Some(policy) => policy,
                    None => {
                        diagnostics.push(format!(
                            "{key} has unsupported value {value:?}; the {} compaction detector is disabled",
                            adapter_kind.as_str()
                        ));
                        CompactionDetectorPolicy::Disabled
                    }
                },
                Err(std::env::VarError::NotPresent) => default,
                Err(error) => {
                    diagnostics.push(format!(
                        "{key} could not be read ({error}); the {} compaction detector is disabled",
                        adapter_kind.as_str()
                    ));
                    CompactionDetectorPolicy::Disabled
                }
            };
            policies.insert(adapter_kind, policy);
        }
        Self {
            policies,
            diagnostics,
        }
    }

    pub fn policy_for(&self, adapter_kind: AdapterKind) -> Option<CompactionDetectorPolicy> {
        self.policies.get(&adapter_kind).copied()
    }
}

pub const fn release_default_policy(adapter_kind: AdapterKind) -> CompactionDetectorPolicy {
    match adapter_kind {
        AdapterKind::CopilotCli
        | AdapterKind::OpencodeCli
        | AdapterKind::KiroCli
        | AdapterKind::QoderCli
        | AdapterKind::CodebuddyCli
        | AdapterKind::QwenCode => CompactionDetectorPolicy::BestEffort,
        AdapterKind::AntigravityApp
        | AdapterKind::CodexCli
        | AdapterKind::ClaudeCodeCli
        | AdapterKind::TraeCnCli
        | AdapterKind::CursorAgent
        | AdapterKind::KimiCodeCli => CompactionDetectorPolicy::Disabled,
    }
}

pub const fn detector_policy_environment_key(adapter_kind: AdapterKind) -> &'static str {
    match adapter_kind {
        AdapterKind::CopilotCli => "ROVAI_INTERNAL_COPILOT_COMPACTION_DETECTOR_POLICY",
        AdapterKind::OpencodeCli => "ROVAI_INTERNAL_OPENCODE_COMPACTION_DETECTOR_POLICY",
        AdapterKind::KiroCli => "ROVAI_INTERNAL_KIRO_COMPACTION_DETECTOR_POLICY",
        AdapterKind::QoderCli => "ROVAI_INTERNAL_QODER_COMPACTION_DETECTOR_POLICY",
        AdapterKind::CodebuddyCli => "ROVAI_INTERNAL_CODEBUDDY_COMPACTION_DETECTOR_POLICY",
        AdapterKind::QwenCode => "ROVAI_INTERNAL_QWEN_COMPACTION_DETECTOR_POLICY",
        AdapterKind::AntigravityApp => "ROVAI_INTERNAL_ANTIGRAVITY_COMPACTION_DETECTOR_POLICY",
        AdapterKind::CodexCli
        | AdapterKind::ClaudeCodeCli
        | AdapterKind::TraeCnCli
        | AdapterKind::CursorAgent
        | AdapterKind::KimiCodeCli => "ROVAI_INTERNAL_UNUSED_COMPACTION_DETECTOR_POLICY",
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PolicyReconciliation {
    pub changed_adapters: Vec<AdapterKind>,
    pub baseline_requirements_created: usize,
}

pub fn reconcile_detector_policies(
    database: &mut Database,
    desired: &DesiredCompactionDetectorPolicies,
) -> Result<PolicyReconciliation> {
    let transaction = database
        .connection_mut()
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    let now = chrono::Utc::now().to_rfc3339();
    let mut changed_adapters = Vec::new();
    let mut baseline_requirements_created = 0_usize;

    for adapter_kind in POLICY_ADAPTERS {
        let desired_policy = desired
            .policy_for(adapter_kind)
            .unwrap_or(CompactionDetectorPolicy::Disabled);
        let existing = transaction
            .query_row(
                "SELECT policy, policy_epoch FROM compaction_detector_policy WHERE adapter_kind = ?1",
                [adapter_kind.as_str()],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()?;
        let old_policy = existing
            .as_ref()
            .and_then(|(policy, _)| CompactionDetectorPolicy::parse(policy))
            .unwrap_or(CompactionDetectorPolicy::Disabled);
        if existing
            .as_ref()
            .is_some_and(|(policy, _)| policy == desired_policy.as_str())
        {
            continue;
        }

        let next_epoch = existing
            .as_ref()
            .map(|(_, epoch)| epoch.saturating_add(1))
            .unwrap_or(1);
        transaction.execute(
            r#"
            INSERT INTO compaction_detector_policy(
                adapter_kind, policy, policy_epoch, release_version,
                applied_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
            ON CONFLICT(adapter_kind) DO UPDATE SET
                policy = excluded.policy,
                policy_epoch = excluded.policy_epoch,
                release_version = excluded.release_version,
                applied_at = excluded.applied_at,
                updated_at = excluded.updated_at
            "#,
            params![
                adapter_kind.as_str(),
                desired_policy.as_str(),
                next_epoch,
                BOOTSTRAP_REDELIVERY_POLICY_RELEASE,
                now,
            ],
        )?;
        transaction.execute(
            r#"
            UPDATE native_session_compaction_observer_lease
            SET status = 'fenced', fenced_at = ?2,
                fence_reason = 'detector_policy_epoch_changed', updated_at = ?2
            WHERE adapter_kind = ?1 AND status = 'active'
            "#,
            params![adapter_kind.as_str(), now],
        )?;

        if old_policy == CompactionDetectorPolicy::Disabled
            && desired_policy == CompactionDetectorPolicy::BestEffort
        {
            let mut statement = transaction.prepare(
                r#"
                SELECT conversation.id, conversation.native_binding_id,
                       conversation.native_binding_generation
                FROM conversation
                JOIN adapter_installation
                  ON adapter_installation.id = conversation.native_adapter_installation_id
                WHERE adapter_installation.adapter_kind = ?1
                  AND conversation.native_session_id IS NOT NULL
                  AND conversation.native_binding_id IS NOT NULL
                  AND conversation.native_binding_generation >= 1
                  AND EXISTS (
                      SELECT 1 FROM runtime_input_delivery
                      WHERE runtime_input_delivery.native_binding_id
                                = conversation.native_binding_id
                        AND runtime_input_delivery.native_binding_generation
                                = conversation.native_binding_generation
                        AND runtime_input_delivery.status = 'accepted'
                  )
                ORDER BY conversation.id
                "#,
            )?;
            let bindings = statement
                .query_map([adapter_kind.as_str()], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            drop(statement);
            for (conversation_id, binding_id, binding_generation) in bindings {
                transaction.execute(
                    r#"
                    INSERT INTO bootstrap_redelivery_requirement(
                        conversation_id, native_binding_id,
                        native_binding_generation, adapter_kind,
                        requested_revision, acknowledged_revision,
                        created_at, updated_at
                    ) VALUES (?1, ?2, ?3, ?4, 1, 0, ?5, ?5)
                    ON CONFLICT(native_binding_id, native_binding_generation)
                    DO UPDATE SET
                        requested_revision = requested_revision + 1,
                        updated_at = excluded.updated_at
                    "#,
                    params![
                        conversation_id,
                        binding_id,
                        binding_generation,
                        adapter_kind.as_str(),
                        now,
                    ],
                )?;
                baseline_requirements_created += 1;
            }
        }
        changed_adapters.push(adapter_kind);
    }
    transaction.commit()?;
    Ok(PolicyReconciliation {
        changed_adapters,
        baseline_requirements_created,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompactionObserverLease {
    pub id: String,
    pub conversation_id: String,
    pub adapter_installation_id: String,
    pub adapter_kind: AdapterKind,
    pub host_instance_id: String,
    pub relay_process_id: String,
    pub native_session_id: String,
    pub native_binding_id: String,
    pub native_binding_generation: i64,
    pub detector_policy_epoch: i64,
}

#[derive(Debug, Clone)]
pub struct EstablishCompactionObserverLease<'a> {
    pub agent_run_id: &'a str,
    pub execution_epoch: i64,
    pub adapter_kind: AdapterKind,
    pub host_instance_id: &'a str,
    pub relay_process_id: &'a str,
    pub native_session_id: &'a str,
}

pub fn establish_compaction_observer_lease(
    database: &mut Database,
    request: &EstablishCompactionObserverLease<'_>,
) -> Result<Option<CompactionObserverLease>> {
    if request.host_instance_id.trim().is_empty()
        || request.relay_process_id.trim().is_empty()
        || request.native_session_id.trim().is_empty()
    {
        anyhow::bail!("Compaction Observer Host and Native Session identities are required");
    }
    let transaction = database
        .connection_mut()
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    let policy_epoch = transaction
        .query_row(
            r#"
            SELECT policy_epoch FROM compaction_detector_policy
            WHERE adapter_kind = ?1 AND policy = 'best_effort'
            "#,
            [request.adapter_kind.as_str()],
            |row| row.get::<_, i64>(0),
        )
        .optional()?;
    let Some(policy_epoch) = policy_epoch else {
        transaction.commit()?;
        return Ok(None);
    };
    let binding = transaction
        .query_row(
            r#"
            SELECT conversation.id,
                   conversation.native_adapter_installation_id,
                   conversation.native_session_id,
                   conversation.native_binding_id,
                   conversation.native_binding_generation,
                   agent_run.runtime_adapter_kind
            FROM agent_run
            JOIN conversation ON conversation.id = agent_run.conversation_id
            WHERE agent_run.id = ?1
              AND agent_run.execution_epoch = ?2
              AND agent_run.status = 'running'
            "#,
            params![request.agent_run_id, request.execution_epoch],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, Option<String>>(5)?,
                ))
            },
        )
        .optional()?
        .context("AgentRun is unavailable for Compaction Observer establishment")?;
    let adapter_installation_id = binding
        .1
        .context("Native Binding has no Adapter Installation")?;
    let native_session_id = binding.2.context("Native Binding has no Session")?;
    let native_binding_id = binding.3.context("Native Binding has no identity")?;
    if binding.4 < 1
        || binding.5.as_deref() != Some(request.adapter_kind.as_str())
        || native_session_id != request.native_session_id
    {
        anyhow::bail!("Compaction Observer establishment was fenced by Native Binding state");
    }
    let existing = transaction
        .query_row(
            r#"
            SELECT id FROM native_session_compaction_observer_lease
            WHERE conversation_id = ?1 AND native_binding_id = ?2
              AND native_binding_generation = ?3
              AND adapter_installation_id = ?4 AND adapter_kind = ?5
              AND host_instance_id = ?6 AND relay_process_id = ?7
              AND native_session_id = ?8
              AND detector_policy_epoch = ?9 AND status = 'active'
            "#,
            params![
                binding.0,
                native_binding_id,
                binding.4,
                adapter_installation_id,
                request.adapter_kind.as_str(),
                request.host_instance_id,
                request.relay_process_id,
                native_session_id,
                policy_epoch,
            ],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if let Some(id) = existing {
        transaction.commit()?;
        return Ok(Some(CompactionObserverLease {
            id,
            conversation_id: binding.0,
            adapter_installation_id,
            adapter_kind: request.adapter_kind,
            host_instance_id: request.host_instance_id.to_string(),
            relay_process_id: request.relay_process_id.to_string(),
            native_session_id,
            native_binding_id,
            native_binding_generation: binding.4,
            detector_policy_epoch: policy_epoch,
        }));
    }
    let now = chrono::Utc::now().to_rfc3339();
    transaction.execute(
        r#"
        UPDATE native_session_compaction_observer_lease
        SET status = 'fenced', fenced_at = ?4,
            fence_reason = 'observer_identity_replaced', updated_at = ?4
        WHERE conversation_id = ?1 AND native_binding_id = ?2
          AND native_binding_generation = ?3 AND status = 'active'
        "#,
        params![binding.0, native_binding_id, binding.4, now],
    )?;
    let id = Uuid::new_v4().to_string();
    transaction.execute(
        r#"
        INSERT INTO native_session_compaction_observer_lease(
            id, conversation_id, adapter_installation_id, adapter_kind,
            host_instance_id, relay_process_id, native_session_id, native_binding_id,
            native_binding_generation, detector_policy_epoch, status,
            created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'active', ?11, ?11)
        "#,
        params![
            id,
            binding.0,
            adapter_installation_id,
            request.adapter_kind.as_str(),
            request.host_instance_id,
            request.relay_process_id,
            native_session_id,
            native_binding_id,
            binding.4,
            policy_epoch,
            now,
        ],
    )?;
    transaction.commit()?;
    Ok(Some(CompactionObserverLease {
        id,
        conversation_id: binding.0,
        adapter_installation_id,
        adapter_kind: request.adapter_kind,
        host_instance_id: request.host_instance_id.to_string(),
        relay_process_id: request.relay_process_id.to_string(),
        native_session_id,
        native_binding_id,
        native_binding_generation: binding.4,
        detector_policy_epoch: policy_epoch,
    }))
}

#[derive(Debug, Clone)]
pub struct SubmitCompactionObservation<'a> {
    pub observer_lease_id: &'a str,
    pub source_observation_id: &'a str,
    pub source_signal: &'a str,
    pub admission_point: &'a str,
    pub source_event_digest: &'a str,
    pub observed_at: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CompactionObservationResult {
    Applied { requested_revision: i64 },
    Duplicate { requested_revision: i64 },
    Fenced,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CompactionOutboxReconciliation {
    pub applied: usize,
    pub duplicates: usize,
    pub discarded: usize,
    pub retained: usize,
}

pub fn reconcile_compaction_observation_outbox(
    database: &mut Database,
    runtime_root: &Path,
    host_filter: Option<(AdapterKind, &str)>,
) -> Result<CompactionOutboxReconciliation> {
    const MAX_RECORD_BYTES: u64 = 64 * 1024;

    let builtin_root = runtime_root.join("builtin-tools");
    if !builtin_root.is_dir() {
        return Ok(CompactionOutboxReconciliation::default());
    }
    let mut reconciliation = CompactionOutboxReconciliation::default();
    for process_entry in fs::read_dir(&builtin_root)? {
        let process_entry = process_entry?;
        let process_root = process_entry.path();
        let process_metadata = fs::symlink_metadata(&process_root)?;
        if !process_metadata.file_type().is_dir() || process_metadata.file_type().is_symlink() {
            continue;
        }
        let Some(relay_process_id) = process_entry.file_name().to_str().map(ToOwned::to_owned)
        else {
            continue;
        };
        if Uuid::parse_str(&relay_process_id).is_err() {
            continue;
        }
        let outbox = process_root.join("compaction-observation-outbox");
        let mut retain_process_root = false;
        if outbox.is_dir() {
            for record_entry in fs::read_dir(&outbox)? {
                let record_entry = record_entry?;
                let path = record_entry.path();
                if path.extension().and_then(|value| value.to_str()) != Some("json") {
                    continue;
                }
                let metadata = fs::symlink_metadata(&path)?;
                if !metadata.file_type().is_file()
                    || metadata.file_type().is_symlink()
                    || metadata.len() > MAX_RECORD_BYTES
                {
                    reconciliation.discarded += 1;
                    let _ = fs::remove_file(&path);
                    continue;
                }
                let record = fs::read(&path).ok().and_then(|bytes| {
                    serde_json::from_slice::<CompactionObservationOutboxRecord>(&bytes).ok()
                });
                let Some(record) = record else {
                    reconciliation.discarded += 1;
                    let _ = fs::remove_file(&path);
                    continue;
                };
                let adapter_kind = record.adapter_kind.parse::<AdapterKind>().ok();
                let record_is_well_formed = record.schema_version
                    == COMPACTION_OBSERVATION_OUTBOX_SCHEMA_VERSION
                    && Uuid::parse_str(&record.request_id).is_ok()
                    && record.relay_process_id == relay_process_id
                    && !record.host_instance_id.trim().is_empty()
                    && !record.native_session_id.trim().is_empty()
                    && !record.source_event_digest.trim().is_empty()
                    && !record.observed_at.trim().is_empty();
                let Some(adapter_kind) = adapter_kind.filter(|_| record_is_well_formed) else {
                    reconciliation.discarded += 1;
                    let _ = fs::remove_file(&path);
                    continue;
                };
                if host_filter.is_some_and(|(expected_adapter, expected_host)| {
                    adapter_kind != expected_adapter || record.host_instance_id != expected_host
                }) {
                    continue;
                }
                let Some((source_signal, admission_point)) = admitted_hook_compaction_signal(
                    adapter_kind,
                    &record.hook_event_name,
                    &record.trigger,
                ) else {
                    reconciliation.discarded += 1;
                    let _ = fs::remove_file(&path);
                    continue;
                };
                let observer_lease_id = active_observer_lease_for_relay(
                    database,
                    adapter_kind,
                    &record.host_instance_id,
                    &record.relay_process_id,
                    &record.native_session_id,
                )?;
                let Some(observer_lease_id) = observer_lease_id else {
                    reconciliation.discarded += 1;
                    let _ = fs::remove_file(&path);
                    continue;
                };
                let source_observation_id =
                    format!("{source_signal}:{}", record.source_event_digest);
                match submit_compaction_observation(
                    database,
                    &SubmitCompactionObservation {
                        observer_lease_id: &observer_lease_id,
                        source_observation_id: &source_observation_id,
                        source_signal,
                        admission_point,
                        source_event_digest: &record.source_event_digest,
                        observed_at: &record.observed_at,
                    },
                ) {
                    Ok(CompactionObservationResult::Applied { .. }) => {
                        reconciliation.applied += 1;
                        let _ = fs::remove_file(&path);
                    }
                    Ok(CompactionObservationResult::Duplicate { .. }) => {
                        reconciliation.duplicates += 1;
                        let _ = fs::remove_file(&path);
                    }
                    Ok(CompactionObservationResult::Fenced) => {
                        reconciliation.discarded += 1;
                        let _ = fs::remove_file(&path);
                    }
                    Err(_) => {
                        reconciliation.retained += 1;
                        retain_process_root = true;
                    }
                }
            }
        }
        if host_filter.is_none() && !retain_process_root {
            let _ = fs::remove_dir_all(&process_root);
        }
    }
    Ok(reconciliation)
}

pub fn submit_compaction_observation(
    database: &mut Database,
    request: &SubmitCompactionObservation<'_>,
) -> Result<CompactionObservationResult> {
    for (name, value) in [
        ("source observation ID", request.source_observation_id),
        ("source signal", request.source_signal),
        ("admission point", request.admission_point),
        ("source event digest", request.source_event_digest),
        ("observed at", request.observed_at),
    ] {
        if value.trim().is_empty() {
            anyhow::bail!("Compaction observation {name} must not be empty");
        }
    }
    let transaction = database
        .connection_mut()
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    let lease = transaction
        .query_row(
            r#"
            SELECT lease.conversation_id, lease.adapter_kind,
                   lease.native_binding_id, lease.native_binding_generation,
                   lease.adapter_installation_id, lease.host_instance_id,
                   lease.native_session_id, lease.detector_policy_epoch,
                   policy.policy, policy.policy_epoch,
                   conversation.native_adapter_installation_id,
                   conversation.native_session_id,
                   conversation.native_binding_id,
                   conversation.native_binding_generation
            FROM native_session_compaction_observer_lease AS lease
            JOIN compaction_detector_policy AS policy
              ON policy.adapter_kind = lease.adapter_kind
            JOIN conversation ON conversation.id = lease.conversation_id
            WHERE lease.id = ?1 AND lease.status = 'active'
            "#,
            [request.observer_lease_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, i64>(9)?,
                    row.get::<_, Option<String>>(10)?,
                    row.get::<_, Option<String>>(11)?,
                    row.get::<_, Option<String>>(12)?,
                    row.get::<_, i64>(13)?,
                ))
            },
        )
        .optional()?;
    let Some(lease) = lease else {
        transaction.commit()?;
        return Ok(CompactionObservationResult::Fenced);
    };
    let binding_is_current = lease.8 == CompactionDetectorPolicy::BestEffort.as_str()
        && lease.7 == lease.9
        && lease.10.as_deref() == Some(lease.4.as_str())
        && lease.11.as_deref() == Some(lease.6.as_str())
        && lease.12.as_deref() == Some(lease.2.as_str())
        && lease.13 == lease.3;
    if !binding_is_current {
        transaction.commit()?;
        return Ok(CompactionObservationResult::Fenced);
    }
    let adapter_kind: AdapterKind = lease.1.parse()?;
    if !qualified_admission(adapter_kind, request.source_signal, request.admission_point) {
        transaction.commit()?;
        return Ok(CompactionObservationResult::Fenced);
    }
    let duplicate = transaction
        .query_row(
            r#"
            SELECT requested_revision
            FROM native_session_compaction_observation
            WHERE native_binding_id = ?1
              AND native_binding_generation = ?2
              AND source_observation_id = ?3
            "#,
            params![lease.2, lease.3, request.source_observation_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?;
    if let Some(requested_revision) = duplicate {
        transaction.commit()?;
        return Ok(CompactionObservationResult::Duplicate { requested_revision });
    }
    let now = chrono::Utc::now().to_rfc3339();
    transaction.execute(
        r#"
        INSERT INTO bootstrap_redelivery_requirement(
            conversation_id, native_binding_id, native_binding_generation,
            adapter_kind, requested_revision, acknowledged_revision,
            created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, 1, 0, ?5, ?5)
        ON CONFLICT(native_binding_id, native_binding_generation)
        DO UPDATE SET requested_revision = requested_revision + 1,
                      updated_at = excluded.updated_at
        "#,
        params![lease.0, lease.2, lease.3, adapter_kind.as_str(), now],
    )?;
    let requested_revision = transaction.query_row(
        r#"
        SELECT requested_revision FROM bootstrap_redelivery_requirement
        WHERE native_binding_id = ?1 AND native_binding_generation = ?2
        "#,
        params![lease.2, lease.3],
        |row| row.get::<_, i64>(0),
    )?;
    transaction.execute(
        r#"
        INSERT INTO native_session_compaction_observation(
            id, observer_lease_id, native_binding_id,
            native_binding_generation, source_observation_id,
            source_signal, admission_point, source_event_digest,
            requested_revision, observed_at, committed_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        "#,
        params![
            Uuid::new_v4().to_string(),
            request.observer_lease_id,
            lease.2,
            lease.3,
            request.source_observation_id,
            request.source_signal,
            request.admission_point,
            request.source_event_digest,
            requested_revision,
            request.observed_at,
            now,
        ],
    )?;
    transaction.commit()?;
    Ok(CompactionObservationResult::Applied { requested_revision })
}

pub fn pending_redelivery_revision(
    database: &Database,
    native_binding_id: &str,
    native_binding_generation: i64,
) -> Result<Option<i64>> {
    database
        .connection()
        .query_row(
            r#"
            SELECT requested_revision
            FROM bootstrap_redelivery_requirement
            WHERE native_binding_id = ?1 AND native_binding_generation = ?2
              AND requested_revision > acknowledged_revision
            "#,
            params![native_binding_id, native_binding_generation],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .context("failed to load Bootstrap Redelivery Requirement")
}

pub fn active_observer_lease_for_relay(
    database: &Database,
    adapter_kind: AdapterKind,
    host_instance_id: &str,
    relay_process_id: &str,
    native_session_id: &str,
) -> Result<Option<String>> {
    database
        .connection()
        .query_row(
            r#"
            SELECT lease.id
            FROM native_session_compaction_observer_lease AS lease
            JOIN compaction_detector_policy AS policy
              ON policy.adapter_kind = lease.adapter_kind
            JOIN conversation ON conversation.id = lease.conversation_id
            WHERE lease.adapter_kind = ?1
              AND lease.host_instance_id = ?2
              AND lease.relay_process_id = ?3
              AND lease.native_session_id = ?4
              AND lease.status = 'active'
              AND policy.policy = 'best_effort'
              AND policy.policy_epoch = lease.detector_policy_epoch
              AND conversation.native_adapter_installation_id
                    = lease.adapter_installation_id
              AND conversation.native_session_id = lease.native_session_id
              AND conversation.native_binding_id = lease.native_binding_id
              AND conversation.native_binding_generation
                    = lease.native_binding_generation
            "#,
            params![
                adapter_kind.as_str(),
                host_instance_id,
                relay_process_id,
                native_session_id,
            ],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .context("failed to resolve Compaction Observer relay authority")
}

pub fn fence_active_observers_for_host(
    database: &mut Database,
    adapter_kind: AdapterKind,
    host_instance_id: &str,
    reason: &str,
) -> Result<usize> {
    if host_instance_id.trim().is_empty() || reason.trim().is_empty() {
        anyhow::bail!("Compaction Observer Host fence requires identity and reason");
    }
    let now = chrono::Utc::now().to_rfc3339();
    database
        .connection_mut()
        .execute(
            r#"
            UPDATE native_session_compaction_observer_lease
            SET status = 'fenced', fenced_at = ?3,
                fence_reason = ?4, updated_at = ?3
            WHERE adapter_kind = ?1 AND host_instance_id = ?2
              AND status = 'active'
            "#,
            params![adapter_kind.as_str(), host_instance_id, now, reason],
        )
        .context("failed to fence Compaction Observer Host")
}

pub fn fence_active_observers_on_core_start(database: &mut Database) -> Result<usize> {
    let now = chrono::Utc::now().to_rfc3339();
    database
        .connection_mut()
        .execute(
            r#"
            UPDATE native_session_compaction_observer_lease
            SET status = 'fenced', fenced_at = ?1,
                fence_reason = 'core_process_restarted', updated_at = ?1
            WHERE status = 'active'
            "#,
            [now],
        )
        .context("failed to fence stale Compaction Observers at Core startup")
}

fn qualified_admission(
    adapter_kind: AdapterKind,
    source_signal: &str,
    admission_point: &str,
) -> bool {
    match adapter_kind {
        AdapterKind::CopilotCli => {
            source_signal == "preCompact" && admission_point == "imminent_edge"
        }
        AdapterKind::OpencodeCli => {
            source_signal == "session.compacted" && admission_point == "completed"
        }
        AdapterKind::KiroCli => {
            source_signal == "_kiro.dev/compaction/status" && admission_point == "completed"
        }
        AdapterKind::QoderCli | AdapterKind::QwenCode => {
            source_signal == "PostCompact" && admission_point == "completed"
        }
        AdapterKind::CodebuddyCli => {
            source_signal == "SessionStart" && admission_point == "completed"
        }
        AdapterKind::CodexCli
        | AdapterKind::ClaudeCodeCli
        | AdapterKind::AntigravityApp
        | AdapterKind::TraeCnCli
        | AdapterKind::CursorAgent
        | AdapterKind::KimiCodeCli => false,
    }
}

pub fn admitted_hook_compaction_signal(
    adapter_kind: AdapterKind,
    hook_event_name: &str,
    trigger: &str,
) -> Option<(&'static str, &'static str)> {
    match adapter_kind {
        AdapterKind::CopilotCli
            if hook_event_name == "preCompact" && matches!(trigger, "manual" | "auto") =>
        {
            Some(("preCompact", "imminent_edge"))
        }
        AdapterKind::OpencodeCli
            if hook_event_name == "session.compacted" && trigger == "completed" =>
        {
            Some(("session.compacted", "completed"))
        }
        AdapterKind::QoderCli | AdapterKind::QwenCode
            if hook_event_name == "PostCompact" && matches!(trigger, "manual" | "auto") =>
        {
            Some(("PostCompact", "completed"))
        }
        AdapterKind::CodebuddyCli if hook_event_name == "SessionStart" && trigger == "compact" => {
            Some(("SessionStart", "completed"))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release_policies() -> DesiredCompactionDetectorPolicies {
        DesiredCompactionDetectorPolicies {
            policies: POLICY_ADAPTERS
                .into_iter()
                .map(|adapter_kind| (adapter_kind, release_default_policy(adapter_kind)))
                .collect(),
            diagnostics: Vec::new(),
        }
    }

    #[test]
    fn release_policy_matrix_keeps_protected_and_antigravity_disabled() {
        assert_eq!(
            release_default_policy(AdapterKind::CopilotCli),
            CompactionDetectorPolicy::BestEffort
        );
        assert_eq!(
            release_default_policy(AdapterKind::QwenCode),
            CompactionDetectorPolicy::BestEffort
        );
        assert_eq!(
            release_default_policy(AdapterKind::CodexCli),
            CompactionDetectorPolicy::Disabled
        );
        assert_eq!(
            release_default_policy(AdapterKind::ClaudeCodeCli),
            CompactionDetectorPolicy::Disabled
        );
        assert_eq!(
            release_default_policy(AdapterKind::AntigravityApp),
            CompactionDetectorPolicy::Disabled
        );
        assert_eq!(
            release_default_policy(AdapterKind::TraeCnCli),
            CompactionDetectorPolicy::Disabled
        );
    }

    #[test]
    fn admission_points_are_runtime_specific() {
        assert!(qualified_admission(
            AdapterKind::CopilotCli,
            "preCompact",
            "imminent_edge"
        ));
        assert!(!qualified_admission(
            AdapterKind::CopilotCli,
            "PostCompact",
            "completed"
        ));
        assert!(qualified_admission(
            AdapterKind::OpencodeCli,
            "session.compacted",
            "completed"
        ));
        assert!(!qualified_admission(
            AdapterKind::OpencodeCli,
            "experimental.session.compacting",
            "completed"
        ));
        assert!(!qualified_admission(
            AdapterKind::AntigravityApp,
            "PostCompact",
            "completed"
        ));
        assert!(qualified_admission(
            AdapterKind::CodebuddyCli,
            "SessionStart",
            "completed"
        ));
        assert!(!qualified_admission(
            AdapterKind::CodebuddyCli,
            "PostCompact",
            "completed"
        ));
    }

    #[test]
    fn policy_reconciliation_is_idempotent_and_epochs_real_changes() {
        let directory =
            std::env::temp_dir().join(format!("rovai-compaction-policy-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let mut database = Database::open(&directory).unwrap();
        let initial = reconcile_detector_policies(&mut database, &release_policies()).unwrap();
        assert_eq!(initial.changed_adapters.len(), POLICY_ADAPTERS.len());
        assert_eq!(initial.baseline_requirements_created, 0);
        let repeated = reconcile_detector_policies(&mut database, &release_policies()).unwrap();
        assert!(repeated.changed_adapters.is_empty());

        let mut disabled = release_policies();
        disabled
            .policies
            .insert(AdapterKind::OpencodeCli, CompactionDetectorPolicy::Disabled);
        reconcile_detector_policies(&mut database, &disabled).unwrap();
        let disabled_epoch: (String, i64) = database
            .connection()
            .query_row(
                r#"
                SELECT policy, policy_epoch FROM compaction_detector_policy
                WHERE adapter_kind = 'opencode-cli'
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(disabled_epoch, ("disabled".to_string(), 2));
        reconcile_detector_policies(&mut database, &release_policies()).unwrap();
        let enabled_epoch: (String, i64) = database
            .connection()
            .query_row(
                r#"
                SELECT policy, policy_epoch FROM compaction_detector_policy
                WHERE adapter_kind = 'opencode-cli'
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(enabled_epoch, ("best_effort".to_string(), 3));
        std::fs::remove_dir_all(directory).unwrap();
    }
}
