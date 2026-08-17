use std::{
    collections::{BTreeMap, BTreeSet},
    time::{Duration as StdDuration, Instant},
};

use anyhow::{Context, Result};
use chrono::{DateTime, Duration, Utc};
use rusqlite::{
    Connection, OptionalExtension,
    functions::{Aggregate, Context as SqlFunctionContext, FunctionFlags},
    params, params_from_iter,
    types::Value as SqlValue,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    agent_profile::AdapterKind,
    db::Database,
    runtime::{AgentRunExecution, NativeSessionResumeDisposition},
};

const MONITORING_SCHEMA_VERSION: i64 = 1;
const USAGE_PARSER_VERSION: i64 = 1;
const JS_MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

struct DecimalSum;

impl Aggregate<Option<String>, Option<String>> for DecimalSum {
    fn init(&self, _context: &mut SqlFunctionContext<'_>) -> rusqlite::Result<Option<String>> {
        Ok(None)
    }

    fn step(
        &self,
        context: &mut SqlFunctionContext<'_>,
        accumulator: &mut Option<String>,
    ) -> rusqlite::Result<()> {
        let Some(value) = context.get::<Option<String>>(0)? else {
            return Ok(());
        };
        let next = add_decimal(accumulator.as_deref().unwrap_or("0"), &value).map_err(|error| {
            rusqlite::Error::UserFunctionError(Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                error.to_string(),
            )))
        })?;
        *accumulator = Some(next);
        Ok(())
    }

    fn finalize(
        &self,
        _context: &mut SqlFunctionContext<'_>,
        accumulator: Option<Option<String>>,
    ) -> rusqlite::Result<Option<String>> {
        Ok(accumulator.flatten())
    }
}

pub(crate) fn register_monitoring_sql_functions(connection: &Connection) -> Result<()> {
    connection
        .create_aggregate_function(
            "rovai_decimal_sum",
            1,
            FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC,
            DecimalSum,
        )
        .context("failed to register monitoring decimal aggregate")?;
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeUsageCounterMode {
    Delta,
    Cumulative,
    Gauge,
}

impl RuntimeUsageCounterMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Delta => "delta",
            Self::Cumulative => "cumulative",
            Self::Gauge => "gauge",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeInputSemantics {
    ExclusiveBuckets,
    CacheInclusiveTotal,
    Unknown,
}

impl RuntimeInputSemantics {
    fn as_str(self) -> &'static str {
        match self {
            Self::ExclusiveBuckets => "exclusive_buckets",
            Self::CacheInclusiveTotal => "cache_inclusive_total",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeUsageFields {
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub reasoning_output_tokens: Option<i64>,
    pub cache_read_input_tokens: Option<i64>,
    pub cache_write_input_tokens: Option<i64>,
    pub context_used_tokens: Option<i64>,
    pub context_size_tokens: Option<i64>,
}

impl RuntimeUsageFields {
    fn is_empty(&self) -> bool {
        self.input_tokens.is_none()
            && self.output_tokens.is_none()
            && self.reasoning_output_tokens.is_none()
            && self.cache_read_input_tokens.is_none()
            && self.cache_write_input_tokens.is_none()
            && self.context_used_tokens.is_none()
            && self.context_size_tokens.is_none()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeUsageCost {
    pub amount: String,
    pub currency: String,
    pub quality: String,
    pub grain: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedRuntimeUsage {
    pub identity_suffix: String,
    pub dialect_id: String,
    pub source: String,
    pub scope: String,
    pub counter_mode: RuntimeUsageCounterMode,
    pub input_semantics: RuntimeInputSemantics,
    pub native_session_id: Option<String>,
    pub native_turn_id: Option<String>,
    pub fields: RuntimeUsageFields,
    pub cost: Option<RuntimeUsageCost>,
    pub occurred_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct MonitoringRunKey {
    agent_run_id: String,
    execution_epoch: i64,
}

#[derive(Debug, Clone)]
pub struct RuntimeUsageRun {
    key: MonitoringRunKey,
    adapter_kind: AdapterKind,
    runtime_version: Option<String>,
    model_id: String,
}

impl RuntimeUsageRun {
    fn from_execution(execution: &AgentRunExecution) -> Self {
        Self {
            key: MonitoringRunKey {
                agent_run_id: execution.agent_run_id.clone(),
                execution_epoch: execution.execution_epoch,
            },
            adapter_kind: execution.runtime.adapter_kind,
            runtime_version: execution.runtime.reported_version.clone(),
            model_id: execution.runtime.model.model_id.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct BufferedUsageKey {
    run: MonitoringRunKey,
    identity_suffix: String,
    dialect_id: String,
    source: String,
    scope: String,
    counter_mode: RuntimeUsageCounterMode,
    input_semantics: RuntimeInputSemantics,
    native_session_id: Option<String>,
    native_turn_id: Option<String>,
    cost_currency: Option<String>,
    cost_quality: Option<String>,
    cost_grain: Option<String>,
}

impl BufferedUsageKey {
    fn new(run: &MonitoringRunKey, observation: &ParsedRuntimeUsage) -> Self {
        Self {
            run: run.clone(),
            identity_suffix: observation.identity_suffix.clone(),
            dialect_id: observation.dialect_id.clone(),
            source: observation.source.clone(),
            scope: observation.scope.clone(),
            counter_mode: observation.counter_mode,
            input_semantics: observation.input_semantics,
            native_session_id: observation.native_session_id.clone(),
            native_turn_id: observation.native_turn_id.clone(),
            cost_currency: observation.cost.as_ref().map(|cost| cost.currency.clone()),
            cost_quality: observation.cost.as_ref().map(|cost| cost.quality.clone()),
            cost_grain: observation.cost.as_ref().map(|cost| cost.grain.clone()),
        }
    }
}

#[derive(Debug, Clone)]
struct BufferedUsageRecord {
    key: BufferedUsageKey,
    observation: ParsedRuntimeUsage,
    source_observations: Vec<(String, ParsedRuntimeUsage)>,
}

impl BufferedUsageRecord {
    fn source_identity(&self) -> String {
        let mut hasher = Sha256::new();
        for (identity, _) in &self.source_observations {
            hasher.update(identity.as_bytes());
            hasher.update([0]);
        }
        format!("coalesced:{:x}", hasher.finalize())
    }
}

#[derive(Debug, Clone)]
pub struct RuntimeUsageFlushBatch {
    run: RuntimeUsageRun,
    records: Vec<BufferedUsageRecord>,
    pending_since: Instant,
    final_flush: bool,
}

#[derive(Debug, Clone)]
pub enum RuntimeUsageFlushTarget {
    Periodic,
    Due {
        now: Instant,
        minimum_interval: StdDuration,
    },
    Run {
        agent_run_id: String,
        execution_epoch: i64,
    },
    All,
}

#[derive(Debug, Default)]
pub struct RuntimeUsageBuffer {
    runs: BTreeMap<MonitoringRunKey, RuntimeUsageRun>,
    pending: BTreeMap<BufferedUsageKey, BufferedUsageRecord>,
    pending_since: BTreeMap<MonitoringRunKey, Instant>,
    seen_source_identities: BTreeSet<(BufferedUsageKey, String)>,
}

impl RuntimeUsageBuffer {
    pub fn observe(
        &mut self,
        execution: &AgentRunExecution,
        source_identity: &str,
        observations: &[ParsedRuntimeUsage],
        now: Instant,
    ) -> Result<()> {
        self.observe_run(
            &RuntimeUsageRun::from_execution(execution),
            source_identity,
            observations,
            now,
        )
    }

    pub fn observe_run(
        &mut self,
        run: &RuntimeUsageRun,
        source_identity: &str,
        observations: &[ParsedRuntimeUsage],
        now: Instant,
    ) -> Result<()> {
        self.runs.insert(run.key.clone(), run.clone());
        for observation in observations {
            validate_usage(observation)?;
            let key = BufferedUsageKey::new(&run.key, observation);
            if !self
                .seen_source_identities
                .insert((key.clone(), source_identity.to_string()))
            {
                continue;
            }
            self.pending_since.entry(run.key.clone()).or_insert(now);
            let source_observations = vec![(source_identity.to_string(), observation.clone())];
            let record = BufferedUsageRecord {
                key: key.clone(),
                observation: observation.clone(),
                source_observations,
            };
            merge_buffered_record(&mut self.pending, record)?;
        }
        Ok(())
    }

    pub fn drain(&mut self, target: RuntimeUsageFlushTarget) -> Vec<RuntimeUsageFlushBatch> {
        let (selected_runs, final_flush) = match target {
            RuntimeUsageFlushTarget::Periodic => {
                (self.pending_since.keys().cloned().collect(), false)
            }
            RuntimeUsageFlushTarget::Due {
                now,
                minimum_interval,
            } => (
                self.pending_since
                    .iter()
                    .filter_map(|(run, pending_since)| {
                        now.checked_duration_since(*pending_since)
                            .is_some_and(|elapsed| elapsed >= minimum_interval)
                            .then_some(run.clone())
                    })
                    .collect::<BTreeSet<_>>(),
                false,
            ),
            RuntimeUsageFlushTarget::Run {
                agent_run_id,
                execution_epoch,
            } => (
                [MonitoringRunKey {
                    agent_run_id,
                    execution_epoch,
                }]
                .into_iter()
                .collect(),
                true,
            ),
            RuntimeUsageFlushTarget::All => (self.pending_since.keys().cloned().collect(), true),
        };
        let mut records = BTreeMap::<MonitoringRunKey, Vec<BufferedUsageRecord>>::new();
        let keys = self
            .pending
            .keys()
            .filter(|key| selected_runs.contains(&key.run))
            .cloned()
            .collect::<Vec<_>>();
        for key in keys {
            if let Some(record) = self.pending.remove(&key) {
                records.entry(key.run.clone()).or_default().push(record);
            }
        }
        records
            .into_iter()
            .filter_map(|(key, records)| {
                let run = self.runs.get(&key)?.clone();
                let pending_since = self.pending_since.remove(&key)?;
                Some(RuntimeUsageFlushBatch {
                    run,
                    records,
                    pending_since,
                    final_flush,
                })
            })
            .collect()
    }

    pub fn restore(&mut self, batches: Vec<RuntimeUsageFlushBatch>) -> Result<()> {
        let newer_pending = std::mem::take(&mut self.pending);
        for batch in batches {
            self.runs.insert(batch.run.key.clone(), batch.run.clone());
            self.pending_since
                .entry(batch.run.key.clone())
                .and_modify(|current| *current = (*current).min(batch.pending_since))
                .or_insert(batch.pending_since);
            for record in batch.records {
                merge_buffered_record(&mut self.pending, record)?;
            }
        }
        for record in newer_pending.into_values() {
            merge_buffered_record(&mut self.pending, record)?;
        }
        Ok(())
    }

    pub fn complete(&mut self, batches: &[RuntimeUsageFlushBatch]) {
        let completed = batches
            .iter()
            .filter(|batch| batch.final_flush)
            .map(|batch| batch.run.key.clone())
            .filter(|run| !self.pending_since.contains_key(run))
            .collect::<BTreeSet<_>>();
        if completed.is_empty() {
            return;
        }
        self.runs.retain(|run, _| !completed.contains(run));
        self.seen_source_identities
            .retain(|(key, _)| !completed.contains(&key.run));
    }

    /// Release terminal/shutdown bookkeeping after the target has no data left
    /// to persist. Callers must only invoke this after a successful flush (or
    /// after `drain` proves that the target was already idle).
    pub fn finish_idle_target_after_flush(&mut self, target: &RuntimeUsageFlushTarget) {
        let candidates: BTreeSet<MonitoringRunKey> = match target {
            RuntimeUsageFlushTarget::Run {
                agent_run_id,
                execution_epoch,
            } => [MonitoringRunKey {
                agent_run_id: agent_run_id.clone(),
                execution_epoch: *execution_epoch,
            }]
            .into_iter()
            .collect(),
            RuntimeUsageFlushTarget::All => self.runs.keys().cloned().collect(),
            RuntimeUsageFlushTarget::Periodic | RuntimeUsageFlushTarget::Due { .. } => return,
        };
        let completed = candidates
            .into_iter()
            .filter(|run| {
                !self.pending_since.contains_key(run)
                    && !self.pending.keys().any(|key| &key.run == run)
            })
            .collect::<BTreeSet<_>>();
        if completed.is_empty() {
            return;
        }
        self.runs.retain(|run, _| !completed.contains(run));
        self.seen_source_identities
            .retain(|(key, _)| !completed.contains(&key.run));
    }
}

fn merge_buffered_record(
    pending: &mut BTreeMap<BufferedUsageKey, BufferedUsageRecord>,
    incoming: BufferedUsageRecord,
) -> Result<()> {
    let Some(current) = pending.get_mut(&incoming.key) else {
        pending.insert(incoming.key.clone(), incoming);
        return Ok(());
    };
    for (identity, observation) in &incoming.source_observations {
        if !current
            .source_observations
            .iter()
            .any(|(current_identity, _)| current_identity == identity)
        {
            current
                .source_observations
                .push((identity.clone(), observation.clone()));
        }
    }
    if current.observation.counter_mode == RuntimeUsageCounterMode::Delta {
        merge_delta_fields(
            &mut current.observation.fields,
            &incoming.observation.fields,
        )?;
        match (
            current.observation.cost.as_mut(),
            incoming.observation.cost.as_ref(),
        ) {
            (Some(current), Some(incoming)) => {
                current.amount = add_decimal(&current.amount, &incoming.amount)?;
            }
            (None, Some(incoming)) => current.observation.cost = Some(incoming.clone()),
            _ => {}
        }
    } else {
        current.observation.fields = incoming.observation.fields.clone();
        current.observation.cost = incoming.observation.cost.clone();
    }
    current.observation.occurred_at = incoming
        .observation
        .occurred_at
        .clone()
        .or_else(|| current.observation.occurred_at.clone());
    Ok(())
}

fn merge_delta_fields(
    current: &mut RuntimeUsageFields,
    incoming: &RuntimeUsageFields,
) -> Result<()> {
    merge_optional_counter(&mut current.input_tokens, incoming.input_tokens)?;
    merge_optional_counter(&mut current.output_tokens, incoming.output_tokens)?;
    merge_optional_counter(
        &mut current.reasoning_output_tokens,
        incoming.reasoning_output_tokens,
    )?;
    merge_optional_counter(
        &mut current.cache_read_input_tokens,
        incoming.cache_read_input_tokens,
    )?;
    merge_optional_counter(
        &mut current.cache_write_input_tokens,
        incoming.cache_write_input_tokens,
    )?;
    if incoming.context_used_tokens.is_some() {
        current.context_used_tokens = incoming.context_used_tokens;
    }
    if incoming.context_size_tokens.is_some() {
        current.context_size_tokens = incoming.context_size_tokens;
    }
    Ok(())
}

fn merge_optional_counter(current: &mut Option<i64>, incoming: Option<i64>) -> Result<()> {
    let Some(incoming) = incoming else {
        return Ok(());
    };
    *current = Some(
        current
            .unwrap_or(0)
            .checked_add(incoming)
            .context("Runtime Usage counter overflow while coalescing")?,
    );
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeSessionOutcome {
    Succeeded,
    Rejected,
    Incompatible,
    Ambiguous,
    Failed,
}

impl NativeSessionOutcome {
    fn as_str(self) -> &'static str {
        match self {
            Self::Succeeded => "succeeded",
            Self::Rejected => "rejected",
            Self::Incompatible => "incompatible",
            Self::Ambiguous => "ambiguous",
            Self::Failed => "failed",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitoringFilter {
    pub range: String,
    #[serde(default)]
    pub adapter_kind: Option<AdapterKind>,
    #[serde(default)]
    pub agent_id: Option<String>,
    #[serde(default)]
    pub terminal_status: Option<String>,
}

impl MonitoringFilter {
    pub fn validate(&self) -> Result<()> {
        if !matches!(self.range.as_str(), "24h" | "7d" | "30d") {
            anyhow::bail!("monitoring range must be one of 24h, 7d, or 30d");
        }
        if let Some(status) = self.terminal_status.as_deref()
            && !matches!(status, "succeeded" | "failed" | "cancelled")
        {
            anyhow::bail!("monitoring terminalStatus is invalid");
        }
        Ok(())
    }

    fn duration(&self) -> Duration {
        match self.range.as_str() {
            "24h" => Duration::hours(24),
            "7d" => Duration::days(7),
            "30d" => Duration::days(30),
            _ => unreachable!("validated monitoring range"),
        }
    }
}

pub struct MonitoringService;

impl MonitoringService {
    pub fn enrolled_usage_run(
        database: &Database,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Result<Option<RuntimeUsageRun>> {
        let row = database
            .connection()
            .query_row(
                r#"
                SELECT adapter_kind, runtime_version, model_id
                FROM monitoring_run_enrollment
                WHERE agent_run_id = ?1 AND execution_epoch = ?2
                "#,
                params![agent_run_id, execution_epoch],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?;
        let Some((adapter_kind, runtime_version, model_id)) = row else {
            return Ok(None);
        };
        Ok(Some(RuntimeUsageRun {
            key: MonitoringRunKey {
                agent_run_id: agent_run_id.to_string(),
                execution_epoch,
            },
            adapter_kind: adapter_kind.parse::<AdapterKind>()?,
            runtime_version,
            model_id,
        }))
    }

    pub fn enroll_run(
        database: &mut Database,
        execution: &AgentRunExecution,
        compaction_observable: bool,
    ) -> Result<bool> {
        let (collection_epoch, collection_started_at) = collection_identity(database)?;
        let run: Option<(String, String)> = database
            .connection()
            .query_row(
                "SELECT created_at, status FROM agent_run WHERE id = ?1",
                [&execution.agent_run_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let Some((run_created_at, run_status)) = run else {
            return Ok(false);
        };
        if parse_time(&run_created_at)? < parse_time(&collection_started_at)? {
            return Ok(false);
        }
        let support = support_snapshot(
            execution.runtime.adapter_kind,
            execution.runtime.reported_version.as_deref(),
            compaction_observable,
        );
        let tool_duration_capability = match support["toolDurationCoverage"].as_str() {
            Some("fine_grained") => "fine_grained",
            Some("run_level") => "covered_only",
            _ => "unavailable",
        };
        let usage_input_supported = support_snapshot_field(&support, "input");
        let usage_output_supported = support_snapshot_field(&support, "output");
        let usage_reasoning_output_supported = support_snapshot_field(&support, "reasoningOutput");
        let usage_cache_read_supported = support_snapshot_field(&support, "cacheRead");
        let usage_cache_write_supported = support_snapshot_field(&support, "cacheWrite");
        let usage_context_used_supported = support_snapshot_field(&support, "contextUsed");
        let usage_context_size_supported = support_snapshot_field(&support, "contextWindow");
        let usage_cost_supported = support_snapshot_field(&support, "reportedCost");
        let enrolled_at = Utc::now();
        let new_rollup_bucket_started_at = hour_bucket(enrolled_at).to_rfc3339();
        let enrolled_at = enrolled_at.to_rfc3339();
        let transaction = database.connection_mut().transaction()?;
        let prior_logical_enrollment: Option<(String, String)> = transaction
            .query_row(
                r#"
                SELECT rollup_bucket_started_at, logical_enrolled_at
                FROM monitoring_run_enrollment
                WHERE collection_epoch = ?1 AND agent_run_id = ?2
                ORDER BY execution_epoch
                LIMIT 1
                "#,
                params![collection_epoch, execution.agent_run_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let (rollup_bucket_started_at, logical_enrolled_at) = prior_logical_enrollment
            .as_ref()
            .cloned()
            .unwrap_or_else(|| (new_rollup_bucket_started_at, enrolled_at.clone()));
        let changed = transaction.execute(
            r#"
            INSERT OR IGNORE INTO monitoring_run_enrollment(
                agent_run_id, collection_epoch, execution_epoch, agent_id,
                adapter_kind, runtime_version, model_id, support_snapshot_json,
                usage_input_supported, usage_output_supported,
                usage_reasoning_output_supported, usage_cache_read_supported,
                usage_cache_write_supported, usage_context_used_supported,
                usage_context_size_supported, usage_cost_supported,
                compaction_observable, tool_duration_capability,
                rollup_bucket_started_at, logical_enrolled_at, enrolled_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21
            )
            "#,
            params![
                execution.agent_run_id,
                collection_epoch,
                execution.execution_epoch,
                execution.agent_id,
                execution.runtime.adapter_kind.as_str(),
                execution.runtime.reported_version,
                execution.runtime.model.model_id,
                serde_json::to_string(&support)?,
                usage_input_supported,
                usage_output_supported,
                usage_reasoning_output_supported,
                usage_cache_read_supported,
                usage_cache_write_supported,
                usage_context_used_supported,
                usage_context_size_supported,
                usage_cost_supported,
                compaction_observable,
                tool_duration_capability,
                rollup_bucket_started_at,
                logical_enrolled_at,
                enrolled_at,
            ],
        )?;
        if changed == 1 && prior_logical_enrollment.is_none() {
            transaction.execute(
                r#"
                INSERT INTO monitoring_run_rollup_hourly(
                    collection_epoch, bucket_started_at, adapter_kind,
                    model_id, agent_id, terminal_status, run_count, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7)
                ON CONFLICT(
                    collection_epoch, bucket_started_at, adapter_kind,
                    model_id, agent_id, terminal_status
                ) DO UPDATE SET
                    run_count = run_count + 1,
                    updated_at = excluded.updated_at
                "#,
                params![
                    collection_epoch,
                    rollup_bucket_started_at,
                    execution.runtime.adapter_kind.as_str(),
                    execution.runtime.model.model_id,
                    execution.agent_id,
                    rollup_status(&run_status),
                    enrolled_at,
                ],
            )?;
        }
        transaction.commit()?;
        Ok(changed == 1)
    }

    pub fn record_usage(
        database: &mut Database,
        execution: &AgentRunExecution,
        source_identity: &str,
        observation: &ParsedRuntimeUsage,
    ) -> Result<bool> {
        validate_usage(observation)?;
        let run = RuntimeUsageRun::from_execution(execution);
        let key = BufferedUsageKey::new(&run.key, observation);
        let source_observations = vec![(source_identity.to_string(), observation.clone())];
        let batch = RuntimeUsageFlushBatch {
            run,
            records: vec![BufferedUsageRecord {
                key,
                observation: observation.clone(),
                source_observations,
            }],
            pending_since: Instant::now(),
            final_flush: false,
        };
        Ok(Self::record_usage_batches(database, &[batch])? == 1)
    }

    pub fn record_usage_batches(
        database: &mut Database,
        batches: &[RuntimeUsageFlushBatch],
    ) -> Result<usize> {
        if batches.is_empty() {
            return Ok(0);
        }
        let identity_salt: String = database.connection().query_row(
            "SELECT identity_salt FROM monitoring_collection_state WHERE singleton = 1",
            [],
            |row| row.get(0),
        )?;
        let transaction = database.connection_mut().transaction()?;
        let mut inserted = 0;
        for batch in batches {
            for record in &batch.records {
                let mut accepted = BTreeMap::new();
                let mut accepted_digests = Vec::new();
                for (source_identity, observation) in &record.source_observations {
                    let digest = source_observation_digest(
                        &identity_salt,
                        &batch.run,
                        &record.key,
                        source_identity,
                    );
                    let already_persisted: bool = transaction.query_row(
                        r#"
                        SELECT EXISTS(
                            SELECT 1
                            FROM runtime_usage_source_observation_dedupe
                            WHERE source_observation_identity_digest = ?1
                        )
                        "#,
                        [&digest],
                        |row| row.get(0),
                    )?;
                    if already_persisted {
                        continue;
                    }
                    accepted_digests.push(digest);
                    merge_buffered_record(
                        &mut accepted,
                        BufferedUsageRecord {
                            key: record.key.clone(),
                            observation: observation.clone(),
                            source_observations: vec![(
                                source_identity.clone(),
                                observation.clone(),
                            )],
                        },
                    )?;
                }
                let Some(accepted) = accepted.into_values().next() else {
                    continue;
                };
                let Some(raw_observation_id) = Self::persist_usage_observation(
                    &transaction,
                    &batch.run,
                    &identity_salt,
                    &accepted.source_identity(),
                    &accepted.observation,
                )?
                else {
                    continue;
                };
                for digest in accepted_digests {
                    transaction.execute(
                        r#"
                        INSERT INTO runtime_usage_source_observation_dedupe(
                            source_observation_identity_digest,
                            raw_observation_id,
                            observed_at
                        ) VALUES (?1, ?2, ?3)
                        "#,
                        params![digest, raw_observation_id, Utc::now().to_rfc3339()],
                    )?;
                }
                inserted += 1;
            }
        }
        transaction.commit()?;
        Ok(inserted)
    }

    pub fn record_session_decision(
        database: &mut Database,
        execution: &AgentRunExecution,
        disposition: NativeSessionResumeDisposition,
    ) -> Result<bool> {
        let collection_epoch: Option<String> = database
            .connection()
            .query_row(
                "SELECT collection_epoch FROM monitoring_run_enrollment WHERE agent_run_id = ?1 AND execution_epoch = ?2",
                params![execution.agent_run_id, execution.execution_epoch],
                |row| row.get(0),
            )
            .optional()?;
        let Some(collection_epoch) = collection_epoch else {
            return Ok(false);
        };
        let (disposition, requested) = match disposition {
            NativeSessionResumeDisposition::New => ("new", false),
            NativeSessionResumeDisposition::Compatible => ("compatible", true),
            NativeSessionResumeDisposition::Controlled => ("controlled", true),
        };
        let now = Utc::now().to_rfc3339();
        database.connection_mut().execute(
            r#"
            INSERT INTO agent_run_native_session_fact(
                agent_run_id, collection_epoch, execution_epoch, resume_requested,
                resume_disposition, resume_outcome, resume_rejected,
                fallback_to_new_session, reason_code, native_session_digest,
                decided_at, resolved_at, updated_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, 'not_attempted', 0, 0,
                NULL, NULL, ?6, NULL, ?6
            )
            ON CONFLICT(agent_run_id, execution_epoch) DO UPDATE SET
                collection_epoch = excluded.collection_epoch,
                resume_requested = excluded.resume_requested,
                resume_disposition = excluded.resume_disposition,
                resume_outcome = 'not_attempted',
                resume_rejected = 0,
                fallback_to_new_session = 0,
                reason_code = NULL,
                native_session_digest = NULL,
                decided_at = excluded.decided_at,
                resolved_at = NULL,
                updated_at = excluded.updated_at
            "#,
            params![
                execution.agent_run_id,
                collection_epoch,
                execution.execution_epoch,
                requested,
                disposition,
                now
            ],
        )?;
        Ok(true)
    }

    fn persist_usage_observation(
        transaction: &rusqlite::Transaction<'_>,
        run: &RuntimeUsageRun,
        identity_salt: &str,
        source_identity: &str,
        observation: &ParsedRuntimeUsage,
    ) -> Result<Option<String>> {
        validate_usage(observation)?;
        let collection_epoch: Option<String> = transaction
            .query_row(
                r#"
                SELECT collection_epoch
                FROM monitoring_run_enrollment
                WHERE agent_run_id = ?1 AND execution_epoch = ?2
                "#,
                params![run.key.agent_run_id, run.key.execution_epoch],
                |row| row.get(0),
            )
            .optional()?;
        let Some(collection_epoch) = collection_epoch else {
            return Ok(None);
        };
        let source_digest = digest_identity(
            identity_salt,
            &format!(
                "{}:{}:{}:{}:{}",
                run.key.agent_run_id,
                run.key.execution_epoch,
                source_identity,
                observation.identity_suffix,
                observation.dialect_id
            ),
        );
        let native_session_digest = observation
            .native_session_id
            .as_deref()
            .map(|value| digest_identity(identity_salt, &format!("session:{value}")));
        let native_turn_digest = observation
            .native_turn_id
            .as_deref()
            .map(|value| digest_identity(identity_salt, &format!("turn:{value}")));
        let normalized = normalize_usage(observation);
        let now = Utc::now().to_rfc3339();
        let occurred_at = observation.occurred_at.as_deref().unwrap_or(&now);
        let source_kind = format!(
            "{}:{}:{}",
            observation.source, observation.scope, observation.dialect_id
        );
        let raw_id = Uuid::new_v4().to_string();
        let inserted = transaction.execute(
            r#"
            INSERT OR IGNORE INTO runtime_usage_raw_observation(
                id, collection_epoch, agent_run_id, execution_epoch, adapter_kind,
                runtime_version, dialect_id, source, scope, source_kind,
                source_event_identity_digest, native_session_digest,
                native_turn_digest, native_request_digest, counter_mode,
                model_id, provider, service_tier, input_semantics,
                input_tokens, output_tokens, reasoning_output_tokens,
                cache_read_input_tokens, cache_write_input_tokens,
                context_used_tokens, context_size_tokens, reported_cost_decimal,
                reported_cost_currency, cost_grain, cost_quality,
                occurred_at, observed_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24,
                ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32
            )
            "#,
            params![
                raw_id,
                collection_epoch,
                run.key.agent_run_id,
                run.key.execution_epoch,
                run.adapter_kind.as_str(),
                run.runtime_version,
                observation.dialect_id,
                observation.source,
                observation.scope,
                source_kind,
                source_digest,
                native_session_digest,
                native_turn_digest,
                Option::<&str>::None,
                observation.counter_mode.as_str(),
                run.model_id,
                Option::<&str>::None,
                Option::<&str>::None,
                observation.input_semantics.as_str(),
                observation.fields.input_tokens,
                observation.fields.output_tokens,
                observation.fields.reasoning_output_tokens,
                observation.fields.cache_read_input_tokens,
                observation.fields.cache_write_input_tokens,
                observation.fields.context_used_tokens,
                observation.fields.context_size_tokens,
                observation.cost.as_ref().map(|cost| cost.amount.as_str()),
                observation.cost.as_ref().map(|cost| cost.currency.as_str()),
                observation.cost.as_ref().map(|cost| cost.grain.as_str()),
                observation.cost.as_ref().map(|cost| cost.quality.as_str()),
                occurred_at,
                now,
            ],
        )?;
        if inserted == 0 {
            return Ok(None);
        }
        transaction.execute(
            r#"
            INSERT INTO runtime_usage_normalized_observation(
                raw_observation_id, parser_version, projection_version,
                normalization_status, diagnostic_code, input_tokens, output_tokens,
                reasoning_output_tokens, cache_read_input_tokens,
                cache_write_input_tokens, context_used_tokens, context_size_tokens,
                reported_cost_decimal, reported_cost_currency, cost_grain,
                cost_quality, semantics_json, normalized_at
            ) VALUES (
                ?1, ?2, 1, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                ?13, ?14, ?15, ?16, ?17
            )
            "#,
            params![
                raw_id,
                USAGE_PARSER_VERSION,
                normalized.status,
                normalized.diagnostic_code,
                normalized.fields.input_tokens,
                normalized.fields.output_tokens,
                normalized.fields.reasoning_output_tokens,
                normalized.fields.cache_read_input_tokens,
                normalized.fields.cache_write_input_tokens,
                normalized.fields.context_used_tokens,
                normalized.fields.context_size_tokens,
                observation.cost.as_ref().map(|cost| cost.amount.as_str()),
                observation.cost.as_ref().map(|cost| cost.currency.as_str()),
                observation.cost.as_ref().map(|cost| cost.grain.as_str()),
                observation.cost.as_ref().map(|cost| cost.quality.as_str()),
                serde_json::to_string(&json!({
                    "inputSemantics": observation.input_semantics,
                    "normalizationStatus": normalized.status,
                    "diagnosticCode": normalized.diagnostic_code,
                }))?,
                now,
            ],
        )?;
        Self::update_usage_rollups(
            transaction,
            &collection_epoch,
            run,
            observation,
            &normalized,
            occurred_at,
            &now,
        )?;
        transaction.execute(
            r#"
            INSERT INTO runtime_usage_parser_state(
                adapter_kind, runtime_version, parser_version,
                fixture_digest, status, last_observed_at
            ) VALUES (?1, ?2, ?3, NULL, 'observed', ?4)
            ON CONFLICT(adapter_kind, runtime_version, parser_version) DO UPDATE SET
                status = 'observed',
                last_observed_at = excluded.last_observed_at
            "#,
            params![
                run.adapter_kind.as_str(),
                run.runtime_version.as_deref().unwrap_or("unknown"),
                USAGE_PARSER_VERSION,
                now,
            ],
        )?;
        Ok(Some(raw_id))
    }

    #[allow(clippy::too_many_arguments)]
    fn update_usage_rollups(
        transaction: &rusqlite::Transaction<'_>,
        collection_epoch: &str,
        run: &RuntimeUsageRun,
        observation: &ParsedRuntimeUsage,
        normalized: &NormalizedUsage,
        occurred_at: &str,
        updated_at: &str,
    ) -> Result<()> {
        let occurred_at = parse_time(occurred_at)?.to_rfc3339();
        let delta = observation.counter_mode == RuntimeUsageCounterMode::Delta;
        let input_tokens = delta.then_some(normalized.fields.input_tokens).flatten();
        let output_tokens = delta.then_some(normalized.fields.output_tokens).flatten();
        let reasoning_output_tokens = delta
            .then_some(normalized.fields.reasoning_output_tokens)
            .flatten();
        let cache_read_input_tokens = delta
            .then_some(normalized.fields.cache_read_input_tokens)
            .flatten();
        let cache_write_input_tokens = delta
            .then_some(normalized.fields.cache_write_input_tokens)
            .flatten();
        let context_observed_at = (normalized.fields.context_used_tokens.is_some()
            || normalized.fields.context_size_tokens.is_some())
        .then_some(occurred_at.as_str());
        transaction.execute(
            r#"
            INSERT INTO runtime_usage_run_rollup(
                collection_epoch, agent_run_id, execution_epoch,
                adapter_kind, model_id, input_tokens, output_tokens,
                reasoning_output_tokens, cache_read_input_tokens,
                cache_write_input_tokens, context_used_tokens,
                context_size_tokens, context_observed_at,
                latest_observed_at, updated_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                ?11, ?12, ?13, ?14, ?15
            )
            ON CONFLICT(agent_run_id, execution_epoch) DO UPDATE SET
                input_tokens = CASE WHEN excluded.input_tokens IS NULL
                    THEN runtime_usage_run_rollup.input_tokens
                    ELSE COALESCE(runtime_usage_run_rollup.input_tokens, 0)
                        + excluded.input_tokens END,
                output_tokens = CASE WHEN excluded.output_tokens IS NULL
                    THEN runtime_usage_run_rollup.output_tokens
                    ELSE COALESCE(runtime_usage_run_rollup.output_tokens, 0)
                        + excluded.output_tokens END,
                reasoning_output_tokens = CASE
                    WHEN excluded.reasoning_output_tokens IS NULL
                        THEN runtime_usage_run_rollup.reasoning_output_tokens
                    ELSE COALESCE(
                        runtime_usage_run_rollup.reasoning_output_tokens, 0
                    ) + excluded.reasoning_output_tokens END,
                cache_read_input_tokens = CASE
                    WHEN excluded.cache_read_input_tokens IS NULL
                        THEN runtime_usage_run_rollup.cache_read_input_tokens
                    ELSE COALESCE(
                        runtime_usage_run_rollup.cache_read_input_tokens, 0
                    ) + excluded.cache_read_input_tokens END,
                cache_write_input_tokens = CASE
                    WHEN excluded.cache_write_input_tokens IS NULL
                        THEN runtime_usage_run_rollup.cache_write_input_tokens
                    ELSE COALESCE(
                        runtime_usage_run_rollup.cache_write_input_tokens, 0
                    ) + excluded.cache_write_input_tokens END,
                context_used_tokens = CASE
                    WHEN excluded.context_observed_at IS NULL
                        THEN runtime_usage_run_rollup.context_used_tokens
                    ELSE COALESCE(
                        excluded.context_used_tokens,
                        runtime_usage_run_rollup.context_used_tokens
                    ) END,
                context_size_tokens = CASE
                    WHEN excluded.context_observed_at IS NULL
                        THEN runtime_usage_run_rollup.context_size_tokens
                    ELSE COALESCE(
                        excluded.context_size_tokens,
                        runtime_usage_run_rollup.context_size_tokens
                    ) END,
                context_observed_at = COALESCE(
                    excluded.context_observed_at,
                    runtime_usage_run_rollup.context_observed_at
                ),
                latest_observed_at = MAX(
                    runtime_usage_run_rollup.latest_observed_at,
                    excluded.latest_observed_at
                ),
                updated_at = excluded.updated_at
            "#,
            params![
                collection_epoch,
                run.key.agent_run_id,
                run.key.execution_epoch,
                run.adapter_kind.as_str(),
                run.model_id,
                input_tokens,
                output_tokens,
                reasoning_output_tokens,
                cache_read_input_tokens,
                cache_write_input_tokens,
                normalized.fields.context_used_tokens,
                normalized.fields.context_size_tokens,
                context_observed_at,
                occurred_at,
                updated_at,
            ],
        )?;

        if [
            input_tokens,
            output_tokens,
            reasoning_output_tokens,
            cache_read_input_tokens,
            cache_write_input_tokens,
        ]
        .into_iter()
        .any(|value| value.is_some())
        {
            transaction.execute(
                r#"
                INSERT INTO runtime_usage_rollup_hourly(
                    collection_epoch, bucket_started_at, agent_run_id,
                    execution_epoch, adapter_kind, model_id, input_tokens,
                    output_tokens, reasoning_output_tokens,
                    cache_read_input_tokens, cache_write_input_tokens,
                    latest_observed_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12
                )
                ON CONFLICT(
                    collection_epoch, bucket_started_at,
                    agent_run_id, execution_epoch
                ) DO UPDATE SET
                    input_tokens = CASE WHEN excluded.input_tokens IS NULL
                        THEN runtime_usage_rollup_hourly.input_tokens
                        ELSE COALESCE(runtime_usage_rollup_hourly.input_tokens, 0)
                            + excluded.input_tokens END,
                    output_tokens = CASE WHEN excluded.output_tokens IS NULL
                        THEN runtime_usage_rollup_hourly.output_tokens
                        ELSE COALESCE(runtime_usage_rollup_hourly.output_tokens, 0)
                            + excluded.output_tokens END,
                    reasoning_output_tokens = CASE
                        WHEN excluded.reasoning_output_tokens IS NULL
                            THEN runtime_usage_rollup_hourly.reasoning_output_tokens
                        ELSE COALESCE(
                            runtime_usage_rollup_hourly.reasoning_output_tokens, 0
                        ) + excluded.reasoning_output_tokens END,
                    cache_read_input_tokens = CASE
                        WHEN excluded.cache_read_input_tokens IS NULL
                            THEN runtime_usage_rollup_hourly.cache_read_input_tokens
                        ELSE COALESCE(
                            runtime_usage_rollup_hourly.cache_read_input_tokens, 0
                        ) + excluded.cache_read_input_tokens END,
                    cache_write_input_tokens = CASE
                        WHEN excluded.cache_write_input_tokens IS NULL
                            THEN runtime_usage_rollup_hourly.cache_write_input_tokens
                        ELSE COALESCE(
                            runtime_usage_rollup_hourly.cache_write_input_tokens, 0
                        ) + excluded.cache_write_input_tokens END,
                    latest_observed_at = MAX(
                        runtime_usage_rollup_hourly.latest_observed_at,
                        excluded.latest_observed_at
                    )
                "#,
                params![
                    collection_epoch,
                    hour_bucket(parse_time(&occurred_at)?).to_rfc3339(),
                    run.key.agent_run_id,
                    run.key.execution_epoch,
                    run.adapter_kind.as_str(),
                    run.model_id,
                    input_tokens,
                    output_tokens,
                    reasoning_output_tokens,
                    cache_read_input_tokens,
                    cache_write_input_tokens,
                    occurred_at,
                ],
            )?;
        }

        // Only source-deduplicated deltas are attributable to this AgentRun.
        // ACP usage_update cost is a cumulative Session gauge; without a
        // persisted same-session baseline it remains a raw observation and
        // must never be added to a per-Run/range total.
        if delta && let Some(cost) = &observation.cost {
            let existing: Option<(String, String)> = transaction
                .query_row(
                    r#"
                    SELECT amount_decimal, latest_observed_at
                    FROM runtime_cost_run_rollup
                    WHERE agent_run_id = ?1 AND execution_epoch = ?2
                      AND quality = ?3 AND grain = ?4 AND currency = ?5
                    "#,
                    params![
                        run.key.agent_run_id,
                        run.key.execution_epoch,
                        cost.quality,
                        cost.grain,
                        cost.currency,
                    ],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            let (amount, should_write) = match existing.as_ref() {
                Some((amount, _)) if delta => (add_decimal(amount, &cost.amount)?, true),
                Some((amount, latest)) if parse_time(latest)? > parse_time(&occurred_at)? => {
                    (amount.clone(), false)
                }
                _ => (cost.amount.clone(), true),
            };
            if should_write {
                transaction.execute(
                    r#"
                    INSERT INTO runtime_cost_run_rollup(
                        collection_epoch, agent_run_id, execution_epoch,
                        adapter_kind, model_id, quality, grain, currency,
                        amount_decimal, latest_observed_at,
                        pricing_catalog_version, reconciled_through, updated_at
                    ) VALUES (
                        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                        NULL, NULL, ?11
                    )
                    ON CONFLICT(
                        agent_run_id, execution_epoch, quality, grain, currency
                    ) DO UPDATE SET
                        amount_decimal = excluded.amount_decimal,
                        latest_observed_at = excluded.latest_observed_at,
                        updated_at = excluded.updated_at
                    "#,
                    params![
                        collection_epoch,
                        run.key.agent_run_id,
                        run.key.execution_epoch,
                        run.adapter_kind.as_str(),
                        run.model_id,
                        cost.quality,
                        cost.grain,
                        cost.currency,
                        amount,
                        occurred_at,
                        updated_at,
                    ],
                )?;
            }
        }
        Ok(())
    }

    pub fn record_session_outcome(
        database: &mut Database,
        execution: &AgentRunExecution,
        outcome: NativeSessionOutcome,
        fallback_to_new_session: bool,
        reason_code: Option<&str>,
        native_session_id: Option<&str>,
    ) -> Result<bool> {
        let identity_salt: Option<String> = database
            .connection()
            .query_row(
                "SELECT identity_salt FROM monitoring_collection_state WHERE singleton = 1",
                [],
                |row| row.get(0),
            )
            .optional()?;
        let native_session_digest = identity_salt.as_deref().and_then(|salt| {
            native_session_id.map(|value| digest_identity(salt, &format!("session:{value}")))
        });
        let now = Utc::now().to_rfc3339();
        let changed = database.connection_mut().execute(
            r#"
            UPDATE agent_run_native_session_fact
            SET resume_outcome = ?3,
                resume_rejected = CASE WHEN ?3 = 'rejected' THEN 1 ELSE 0 END,
                fallback_to_new_session = ?4,
                reason_code = ?5,
                native_session_digest = ?6,
                resolved_at = ?7,
                updated_at = ?7
            WHERE agent_run_id = ?1 AND execution_epoch = ?2
              AND resume_requested = 1
              AND (?3 <> 'succeeded' OR resume_outcome = 'not_attempted')
            "#,
            params![
                execution.agent_run_id,
                execution.execution_epoch,
                outcome.as_str(),
                fallback_to_new_session,
                reason_code,
                native_session_digest,
                now,
            ],
        )?;
        Ok(changed == 1)
    }

    pub fn record_session_fallback(
        database: &mut Database,
        execution: &AgentRunExecution,
        native_session_id: &str,
    ) -> Result<bool> {
        let identity_salt: String = database.connection().query_row(
            "SELECT identity_salt FROM monitoring_collection_state WHERE singleton = 1",
            [],
            |row| row.get(0),
        )?;
        let native_session_digest =
            digest_identity(&identity_salt, &format!("session:{native_session_id}"));
        let changed = database.connection_mut().execute(
            r#"
            UPDATE agent_run_native_session_fact
            SET fallback_to_new_session = 1,
                native_session_digest = ?3,
                updated_at = ?4
            WHERE agent_run_id = ?1 AND execution_epoch = ?2
              AND resume_outcome IN (
                  'rejected', 'incompatible', 'ambiguous', 'failed'
              )
            "#,
            params![
                execution.agent_run_id,
                execution.execution_epoch,
                native_session_digest,
                Utc::now().to_rfc3339(),
            ],
        )?;
        Ok(changed == 1)
    }

    pub fn snapshot(database: &mut Database, filter: &MonitoringFilter) -> Result<Value> {
        filter.validate()?;
        let transaction = database.connection_mut().transaction()?;
        let window = collection_window(&transaction, filter)?;
        validate_agent_filter(&transaction, filter)?;
        let runs = load_run_aggregate(&transaction, filter, &window)?;
        let usage = aggregate_usage(&transaction, filter, &window, &runs)?;
        let session = session_summary(&transaction, filter, &window)?;
        let attention = attention_summary(&transaction, filter, &window, &runs)?;
        let summary = build_summary(
            &transaction,
            filter,
            &window,
            &runs,
            &usage,
            &session,
            &attention,
        )?;
        let reliability = build_reliability(
            &transaction,
            filter,
            &window,
            &runs,
            &usage,
            &session,
            &attention,
        )?;
        let usage = build_usage_view(filter, &window, &usage);
        let response = json!({
            "schemaVersion": MONITORING_SCHEMA_VERSION,
            "collection": window.as_json(),
            "filter": filter,
            "summary": summary,
            "usage": usage,
            "reliability": reliability,
        });
        transaction.commit()?;
        Ok(response)
    }
}

#[derive(Debug, Clone)]
struct CollectionWindow {
    collection_epoch: String,
    collection_started_at: String,
    requested_start_at: String,
    effective_start_at: String,
    end_at: String,
    observed_at: String,
}

impl CollectionWindow {
    fn as_json(&self) -> Value {
        json!({
            "schemaVersion": MONITORING_SCHEMA_VERSION,
            "collectionEpoch": self.collection_epoch,
            "collectionStartedAt": self.collection_started_at,
            "requestedStartAt": self.requested_start_at,
            "effectiveStartAt": self.effective_start_at,
            "endAt": self.end_at,
            "observedAt": self.observed_at,
        })
    }
}

#[derive(Debug, Clone, Default)]
struct RunAggregate {
    total: usize,
    active: usize,
    terminal: usize,
    succeeded: usize,
    failed: usize,
    cancelled: usize,
    latest_observed_at: Option<String>,
    input_eligible: usize,
    output_eligible: usize,
    reasoning_eligible: usize,
    cache_read_eligible: usize,
    cache_write_eligible: usize,
    context_eligible: usize,
    cost_eligible: usize,
    cache_observable: usize,
    compaction_eligible: usize,
    evidence_observed_runs: usize,
    evidence_count: i64,
    evidence_latest_observed_at: Option<String>,
    active_without_evidence: usize,
    queue_observed: usize,
    queue_p95_millis: Option<i64>,
    execution_observed: usize,
    execution_p95_millis: Option<i64>,
    end_to_end_observed: usize,
    end_to_end_p95_millis: Option<i64>,
    by_runtime: Vec<RuntimeAggregate>,
}

#[derive(Debug, Clone)]
struct RuntimeAggregate {
    adapter_kind: String,
    total: usize,
    active: usize,
    terminal: usize,
    succeeded: usize,
    failed: usize,
    end_to_end_observed: usize,
    end_to_end_p95_millis: Option<i64>,
    latest_observed_at: Option<String>,
    last_error_code: Option<String>,
}

fn collection_window(
    connection: &Connection,
    filter: &MonitoringFilter,
) -> Result<CollectionWindow> {
    let (collection_epoch, collection_started_at): (String, String) = connection.query_row(
        r#"
        SELECT collection_epoch, collection_started_at
        FROM monitoring_collection_state
        WHERE singleton = 1
        "#,
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let observed_at = Utc::now();
    let requested_start = observed_at - filter.duration();
    let collection_start = parse_time(&collection_started_at)?;
    let effective_start = requested_start.max(collection_start);
    Ok(CollectionWindow {
        collection_epoch,
        collection_started_at,
        requested_start_at: requested_start.to_rfc3339(),
        effective_start_at: effective_start.to_rfc3339(),
        end_at: observed_at.to_rfc3339(),
        observed_at: observed_at.to_rfc3339(),
    })
}

fn validate_agent_filter(connection: &Connection, filter: &MonitoringFilter) -> Result<()> {
    let Some(agent_id) = filter.agent_id.as_deref() else {
        return Ok(());
    };
    let exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM agent_profile WHERE id = ?1)",
        [agent_id],
        |row| row.get(0),
    )?;
    if !exists {
        anyhow::bail!("monitoring agentId does not identify a retained AgentProfile");
    }
    Ok(())
}

fn scope_clause(filter: &MonitoringFilter, window: &CollectionWindow) -> (String, Vec<SqlValue>) {
    let mut clause = "e.collection_epoch = ? AND e.logical_enrolled_at >= ? \
        AND e.logical_enrolled_at <= ?"
        .to_string();
    let mut values = vec![
        SqlValue::Text(window.collection_epoch.clone()),
        SqlValue::Text(window.effective_start_at.clone()),
        SqlValue::Text(window.end_at.clone()),
    ];
    if let Some(adapter_kind) = filter.adapter_kind {
        clause.push_str(" AND e.adapter_kind = ?");
        values.push(SqlValue::Text(adapter_kind.as_str().to_string()));
    }
    if let Some(agent_id) = &filter.agent_id {
        clause.push_str(" AND e.agent_id = ?");
        values.push(SqlValue::Text(agent_id.clone()));
    }
    if let Some(status) = &filter.terminal_status {
        clause.push_str(" AND ar.status = ?");
        values.push(SqlValue::Text(status.clone()));
    }
    (clause, values)
}

fn load_run_aggregate(
    connection: &Connection,
    filter: &MonitoringFilter,
    window: &CollectionWindow,
) -> Result<RunAggregate> {
    let (scope, values) = scope_clause(filter, window);
    let sql = format!(
        r#"
        WITH logical AS (
            SELECT e.agent_run_id, e.adapter_kind,
                   e.usage_input_supported, e.usage_output_supported,
                   e.usage_reasoning_output_supported,
                   e.usage_cache_read_supported, e.usage_cache_write_supported,
                   e.usage_context_used_supported, e.usage_context_size_supported,
                   e.usage_cost_supported, e.compaction_observable,
                   ar.status, ar.created_at, ar.started_at, ar.ended_at,
                   e.logical_enrolled_at,
                   (
                       SELECT MIN(activity.first_visible_activity_at)
                       FROM monitoring_run_enrollment activity
                       WHERE activity.collection_epoch = e.collection_epoch
                         AND activity.agent_run_id = e.agent_run_id
                   ) AS first_visible_activity_at,
                   (
                       SELECT COALESCE(SUM(activity.evidence_count), 0)
                       FROM monitoring_run_enrollment activity
                       WHERE activity.collection_epoch = e.collection_epoch
                         AND activity.agent_run_id = e.agent_run_id
                   ) AS evidence_count
            FROM monitoring_run_enrollment e
            JOIN agent_run ar ON ar.id = e.agent_run_id
            WHERE {scope}
              AND e.execution_epoch = (
                  SELECT MIN(candidate.execution_epoch)
                  FROM monitoring_run_enrollment candidate
                  WHERE candidate.collection_epoch = e.collection_epoch
                    AND candidate.agent_run_id = e.agent_run_id
              )
        ), durations AS (
            SELECT *,
                   CAST(ROUND(
                       (julianday(started_at) - julianday(created_at))
                       * 86400000.0
                   ) AS INTEGER) AS queue_millis,
                   CAST(ROUND(
                       (julianday(ended_at) - julianday(started_at))
                       * 86400000.0
                   ) AS INTEGER) AS execution_millis,
                   CAST(ROUND(
                       (julianday(ended_at) - julianday(created_at))
                       * 86400000.0
                   ) AS INTEGER) AS end_to_end_millis
            FROM logical
        ), queue_ranked AS (
            SELECT queue_millis,
                   ROW_NUMBER() OVER (ORDER BY queue_millis) AS sample_rank,
                   COUNT(*) OVER () AS sample_count
            FROM durations
            WHERE queue_millis >= 0
        ), execution_ranked AS (
            SELECT execution_millis,
                   ROW_NUMBER() OVER (ORDER BY execution_millis) AS sample_rank,
                   COUNT(*) OVER () AS sample_count
            FROM durations
            WHERE execution_millis >= 0
        ), end_to_end_ranked AS (
            SELECT end_to_end_millis,
                   ROW_NUMBER() OVER (ORDER BY end_to_end_millis) AS sample_rank,
                   COUNT(*) OVER () AS sample_count
            FROM durations
            WHERE end_to_end_millis >= 0
        )
        SELECT
            COUNT(*),
            COALESCE(SUM(status IN ('queued', 'running', 'waiting')), 0),
            COALESCE(SUM(status IN ('succeeded', 'failed', 'cancelled')), 0),
            COALESCE(SUM(status = 'succeeded'), 0),
            COALESCE(SUM(status = 'failed'), 0),
            COALESCE(SUM(status = 'cancelled'), 0),
            MAX(logical_enrolled_at),
            COALESCE(SUM(usage_input_supported), 0),
            COALESCE(SUM(usage_output_supported), 0),
            COALESCE(SUM(usage_reasoning_output_supported), 0),
            COALESCE(SUM(usage_cache_read_supported), 0),
            COALESCE(SUM(usage_cache_write_supported), 0),
            COALESCE(SUM(
                usage_context_used_supported AND usage_context_size_supported
            ), 0),
            COALESCE(SUM(usage_cost_supported), 0),
            COALESCE(SUM(
                usage_cache_read_supported AND usage_cache_write_supported
            ), 0),
            COALESCE(SUM(compaction_observable), 0),
            COALESCE(SUM(evidence_count > 0), 0),
            COALESCE(SUM(evidence_count), 0),
            MAX(first_visible_activity_at),
            COALESCE(SUM(
                status IN ('running', 'waiting') AND evidence_count = 0
            ), 0),
            (SELECT COUNT(*) FROM queue_ranked),
            (SELECT queue_millis FROM queue_ranked
             WHERE sample_rank = (sample_count * 95 + 99) / 100),
            (SELECT COUNT(*) FROM execution_ranked),
            (SELECT execution_millis FROM execution_ranked
             WHERE sample_rank = (sample_count * 95 + 99) / 100),
            (SELECT COUNT(*) FROM end_to_end_ranked),
            (SELECT end_to_end_millis FROM end_to_end_ranked
             WHERE sample_rank = (sample_count * 95 + 99) / 100)
        FROM durations
        "#
    );
    let mut aggregate = connection.query_row(&sql, params_from_iter(values), |row| {
        Ok(RunAggregate {
            total: row.get::<_, i64>(0)? as usize,
            active: row.get::<_, i64>(1)? as usize,
            terminal: row.get::<_, i64>(2)? as usize,
            succeeded: row.get::<_, i64>(3)? as usize,
            failed: row.get::<_, i64>(4)? as usize,
            cancelled: row.get::<_, i64>(5)? as usize,
            latest_observed_at: row.get(6)?,
            input_eligible: row.get::<_, i64>(7)? as usize,
            output_eligible: row.get::<_, i64>(8)? as usize,
            reasoning_eligible: row.get::<_, i64>(9)? as usize,
            cache_read_eligible: row.get::<_, i64>(10)? as usize,
            cache_write_eligible: row.get::<_, i64>(11)? as usize,
            context_eligible: row.get::<_, i64>(12)? as usize,
            cost_eligible: row.get::<_, i64>(13)? as usize,
            cache_observable: row.get::<_, i64>(14)? as usize,
            compaction_eligible: row.get::<_, i64>(15)? as usize,
            evidence_observed_runs: row.get::<_, i64>(16)? as usize,
            evidence_count: row.get(17)?,
            evidence_latest_observed_at: row.get(18)?,
            active_without_evidence: row.get::<_, i64>(19)? as usize,
            queue_observed: row.get::<_, i64>(20)? as usize,
            queue_p95_millis: row.get(21)?,
            execution_observed: row.get::<_, i64>(22)? as usize,
            execution_p95_millis: row.get(23)?,
            end_to_end_observed: row.get::<_, i64>(24)? as usize,
            end_to_end_p95_millis: row.get(25)?,
            by_runtime: Vec::new(),
        })
    })?;

    let (scope, values) = scope_clause(filter, window);
    let runtime_sql = format!(
        r#"
        WITH logical AS (
            SELECT e.adapter_kind, ar.status, ar.created_at, ar.ended_at,
                   e.logical_enrolled_at, ar.last_error_code,
                   CAST(ROUND(
                       (julianday(ar.ended_at) - julianday(ar.created_at))
                       * 86400000.0
                   ) AS INTEGER) AS end_to_end_millis
            FROM monitoring_run_enrollment e
            JOIN agent_run ar ON ar.id = e.agent_run_id
            WHERE {scope}
              AND e.execution_epoch = (
                  SELECT MIN(candidate.execution_epoch)
                  FROM monitoring_run_enrollment candidate
                  WHERE candidate.collection_epoch = e.collection_epoch
                    AND candidate.agent_run_id = e.agent_run_id
              )
        ), grouped AS (
            SELECT adapter_kind, COUNT(*) AS run_count,
                   SUM(status IN ('queued', 'running', 'waiting')) AS active_count,
                   SUM(status IN ('succeeded', 'failed', 'cancelled')) AS terminal_count,
                   SUM(status = 'succeeded') AS succeeded_count,
                   SUM(status = 'failed') AS failed_count,
                   MAX(logical_enrolled_at) AS latest_observed_at
            FROM logical
            GROUP BY adapter_kind
        ), end_to_end_ranked AS (
            SELECT adapter_kind, end_to_end_millis,
                   ROW_NUMBER() OVER (
                       PARTITION BY adapter_kind ORDER BY end_to_end_millis
                   ) AS sample_rank,
                   COUNT(*) OVER (PARTITION BY adapter_kind) AS sample_count
            FROM logical
            WHERE end_to_end_millis >= 0
        )
        SELECT grouped.adapter_kind, grouped.run_count, grouped.active_count,
               grouped.terminal_count, grouped.succeeded_count,
               grouped.failed_count,
               (SELECT COUNT(*) FROM end_to_end_ranked ranked
                WHERE ranked.adapter_kind = grouped.adapter_kind),
               (SELECT ranked.end_to_end_millis
                FROM end_to_end_ranked ranked
                WHERE ranked.adapter_kind = grouped.adapter_kind
                  AND ranked.sample_rank = (ranked.sample_count * 95 + 99) / 100),
               grouped.latest_observed_at,
               (SELECT latest.last_error_code
                FROM logical latest
                WHERE latest.adapter_kind = grouped.adapter_kind
                  AND latest.last_error_code IS NOT NULL
                ORDER BY latest.logical_enrolled_at DESC
                LIMIT 1)
        FROM grouped
        ORDER BY grouped.adapter_kind
        "#
    );
    let mut statement = connection.prepare(&runtime_sql)?;
    aggregate.by_runtime = statement
        .query_map(params_from_iter(values), |row| {
            Ok(RuntimeAggregate {
                adapter_kind: row.get(0)?,
                total: row.get::<_, i64>(1)? as usize,
                active: row.get::<_, i64>(2)? as usize,
                terminal: row.get::<_, i64>(3)? as usize,
                succeeded: row.get::<_, i64>(4)? as usize,
                failed: row.get::<_, i64>(5)? as usize,
                end_to_end_observed: row.get::<_, i64>(6)? as usize,
                end_to_end_p95_millis: row.get(7)?,
                latest_observed_at: row.get(8)?,
                last_error_code: row.get(9)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(aggregate)
}

fn metric(
    value: Option<Value>,
    observed_count: usize,
    eligible_count: usize,
    source: &str,
    quality: &[&str],
    latest_observed_at: Option<String>,
    diagnostic_code: Option<&str>,
) -> Value {
    let eligible_count = eligible_count.max(observed_count);
    let coverage = (eligible_count > 0).then_some(observed_count as f64 / eligible_count as f64);
    let availability = if value.is_none() || observed_count == 0 {
        "unavailable"
    } else if observed_count >= eligible_count {
        "available"
    } else {
        "partial"
    };
    let diagnostic_code = diagnostic_code.map(str::to_string).or_else(|| {
        if eligible_count == 0 {
            Some("no_eligible_runs".to_string())
        } else if observed_count == 0 {
            Some("no_observations".to_string())
        } else {
            None
        }
    });
    json!({
        "availability": availability,
        "value": value,
        "numerator": Value::Null,
        "denominator": Value::Null,
        "observedCount": observed_count,
        "eligibleCount": eligible_count,
        "coverage": coverage,
        "source": source,
        "quality": quality,
        "latestObservedAt": latest_observed_at,
        "diagnosticCode": diagnostic_code,
    })
}

fn ratio_metric(
    numerator: i64,
    denominator: i64,
    observation_counts: (usize, usize),
    source: &str,
    quality: &[&str],
    latest_observed_at: Option<String>,
    zero_code: &str,
) -> Value {
    let (observed_count, eligible_count) = observation_counts;
    if denominator <= 0 {
        let mut result = metric(
            None,
            observed_count,
            eligible_count,
            source,
            quality,
            latest_observed_at,
            Some(zero_code),
        );
        result["numerator"] = json!(numerator);
        result["denominator"] = json!(denominator);
        return result;
    }
    let mut result = metric(
        Some(json!(numerator as f64 / denominator as f64)),
        observed_count,
        eligible_count,
        source,
        quality,
        latest_observed_at,
        None,
    );
    result["numerator"] = json!(numerator);
    result["denominator"] = json!(denominator);
    result
}

fn unavailable_metric(eligible_count: usize, code: &str, source: &str) -> Value {
    metric(None, 0, eligible_count, source, &[], None, Some(code))
}

fn build_summary(
    connection: &Connection,
    filter: &MonitoringFilter,
    window: &CollectionWindow,
    runs: &RunAggregate,
    usage: &UsageAggregate,
    session: &Value,
    attention: &Value,
) -> Result<Value> {
    let latest = runs.latest_observed_at.clone();
    let by_runtime = runs
        .by_runtime
        .iter()
        .map(|runtime| {
            json!({
                "adapterKind": runtime.adapter_kind,
                "runs": runtime.total,
                "activeRuns": runtime.active,
                "successRate": ratio_metric(
                    runtime.succeeded as i64,
                    runtime.terminal as i64,
                    (runtime.terminal, runtime.terminal),
                    "core_fact",
                    &["authoritative_core"],
                    runtime.latest_observed_at.clone(),
                    "no_terminal_runs"
                ),
                "endToEndP95Millis": metric(
                    runtime.end_to_end_p95_millis.map(|value| json!(value)),
                    runtime.end_to_end_observed,
                    runtime.terminal,
                    "core_fact",
                    &["authoritative_core"],
                    runtime.latest_observed_at.clone(),
                    None
                ),
            })
        })
        .collect::<Vec<_>>();
    let trend = trend_buckets(connection, filter, window)?;
    let cost_qualities = best_cost_qualities(&usage.best_cost);
    let cost_metric = metric(
        (!usage.best_cost.is_empty()).then(|| json!(usage.best_cost)),
        usage.cost_observed_runs,
        usage.cost_eligible_runs,
        "runtime_native",
        &cost_qualities,
        usage.cost_latest_observed_at.clone(),
        None,
    );
    Ok(json!({
        "schemaVersion": MONITORING_SCHEMA_VERSION,
        "collection": window.as_json(),
        "filter": filter,
        "runs": metric(
            (runs.total > 0).then(|| json!(runs.total)),
            runs.total,
            runs.total,
            "core_fact",
            &["authoritative_core"],
            latest.clone(),
            None
        ),
        "activeRuns": metric(
            (runs.total > 0).then(|| json!(runs.active)),
            runs.total,
            runs.total,
            "core_fact",
            &["authoritative_core"],
            latest.clone(),
            None
        ),
        "successRate": ratio_metric(
            runs.succeeded as i64,
            runs.terminal as i64,
            (runs.terminal, runs.terminal),
            "core_fact",
            &["authoritative_core"],
            latest.clone(),
            "no_terminal_runs"
        ),
        "endToEndP95Millis": metric(
            runs.end_to_end_p95_millis.map(|value| json!(value)),
            runs.end_to_end_observed,
            runs.terminal,
            "core_fact",
            &["authoritative_core"],
            latest.clone(),
            None
        ),
        "nativeSessionContinuationRate": session["continuationRate"].clone(),
        "cacheReadTokenShare": usage.cache_read_token_share,
        "bestAvailableCost": cost_metric,
        "trend": trend,
        "terminalDistribution": {
            "succeeded": runs.succeeded,
            "failed": runs.failed,
            "cancelled": runs.cancelled,
            "active": runs.active,
        },
        "byRuntime": by_runtime,
        "attention": attention,
    }))
}

fn best_cost_qualities(values: &[Value]) -> Vec<&'static str> {
    let mut qualities = Vec::new();
    for value in values {
        let quality = match value.get("quality").and_then(Value::as_str) {
            Some("provider_reconciled") => "provider_reconciled",
            Some("runtime_reported") => "runtime_reported",
            Some("runtime_estimate") => "runtime_estimate",
            Some("price_estimated") => "price_estimated",
            Some("tokenizer_price_estimated") => "tokenizer_estimated",
            _ => continue,
        };
        if !qualities.contains(&quality) {
            qualities.push(quality);
        }
    }
    qualities
}

fn trend_buckets(
    connection: &Connection,
    filter: &MonitoringFilter,
    window: &CollectionWindow,
) -> Result<Vec<Value>> {
    let bucket_hours = if filter.range == "24h" { 1 } else { 24 };
    let end = parse_time(&window.end_at)?;
    let maximum_bucket_count = if bucket_hours == 1 {
        24
    } else if filter.range == "7d" {
        7
    } else {
        30
    };
    let aligned_end = hour_bucket(end) + Duration::hours(1);
    let start = hour_bucket(parse_time(&window.effective_start_at)?)
        .max(aligned_end - Duration::hours(bucket_hours * maximum_bucket_count as i64));
    let elapsed_seconds = (aligned_end - start).num_seconds().max(1);
    let bucket_seconds = bucket_hours * 60 * 60;
    let bucket_count = ((elapsed_seconds + bucket_seconds - 1) / bucket_seconds) as usize;
    let bucket_count = bucket_count.min(maximum_bucket_count);
    #[derive(Default)]
    struct TrendCounts {
        runs: i64,
        succeeded: i64,
        failed: i64,
        cancelled: i64,
    }
    let mut counts = (0..bucket_count)
        .map(|_| TrendCounts::default())
        .collect::<Vec<_>>();
    let mut clause =
        "collection_epoch = ? AND bucket_started_at >= ? AND bucket_started_at < ?".to_string();
    let mut values = vec![
        SqlValue::Text(window.collection_epoch.clone()),
        SqlValue::Text(start.to_rfc3339()),
        SqlValue::Text(window.end_at.clone()),
    ];
    if let Some(adapter_kind) = filter.adapter_kind {
        clause.push_str(" AND adapter_kind = ?");
        values.push(SqlValue::Text(adapter_kind.as_str().to_string()));
    }
    if let Some(agent_id) = &filter.agent_id {
        clause.push_str(" AND agent_id = ?");
        values.push(SqlValue::Text(agent_id.clone()));
    }
    if let Some(status) = &filter.terminal_status {
        clause.push_str(" AND terminal_status = ?");
        values.push(SqlValue::Text(status.clone()));
    }
    let sql = format!(
        r#"
        SELECT bucket_started_at, terminal_status, SUM(run_count)
        FROM monitoring_run_rollup_hourly
        WHERE {clause}
        GROUP BY bucket_started_at, terminal_status
        ORDER BY bucket_started_at, terminal_status
        "#
    );
    let mut statement = connection.prepare(&sql)?;
    let rows = statement
        .query_map(params_from_iter(values), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (bucket_started_at, status, run_count) in rows {
        let offset_hours = (parse_time(&bucket_started_at)? - start).num_hours();
        if offset_hours < 0 {
            continue;
        }
        let index = (offset_hours / bucket_hours) as usize;
        let Some(bucket) = counts.get_mut(index) else {
            continue;
        };
        bucket.runs += run_count;
        match status.as_str() {
            "succeeded" => bucket.succeeded += run_count,
            "failed" => bucket.failed += run_count,
            "cancelled" => bucket.cancelled += run_count,
            _ => {}
        }
    }
    let mut buckets = Vec::with_capacity(bucket_count);
    for (index, count) in counts.iter().enumerate().take(bucket_count) {
        let bucket_start = start + Duration::hours(index as i64 * bucket_hours);
        let bucket_end = (bucket_start + Duration::hours(bucket_hours)).min(end);
        buckets.push(json!({
            "startAt": bucket_start.to_rfc3339(),
            "endAt": bucket_end.to_rfc3339(),
            "runs": count.runs,
            "succeeded": count.succeeded,
            "failed": count.failed,
            "cancelled": count.cancelled,
        }));
    }
    Ok(buckets)
}

#[derive(Debug)]
struct UsageAggregate {
    input_tokens: Value,
    output_tokens: Value,
    reasoning_output_tokens: Value,
    cache_read_input_tokens: Value,
    cache_write_input_tokens: Value,
    cache_read_token_share: Value,
    cache_read_write_amortization: Value,
    context_usage_rate: Value,
    cost_layers: Vec<Value>,
    by_runtime_and_model: Vec<Value>,
    best_cost: Vec<Value>,
    cost_observed_runs: usize,
    cost_eligible_runs: usize,
    cost_latest_observed_at: Option<String>,
    cache_observable_run_count: usize,
}

#[derive(Debug)]
struct UsageScalar {
    input_sum: Option<i64>,
    input_observed: usize,
    output_sum: Option<i64>,
    output_observed: usize,
    reasoning_sum: Option<i64>,
    reasoning_observed: usize,
    cache_read_sum: Option<i64>,
    cache_read_observed: usize,
    cache_write_sum: Option<i64>,
    cache_write_observed: usize,
    cache_share_numerator: i64,
    cache_share_denominator: i64,
    cache_share_observed: usize,
    cache_read_write_observed: usize,
    context_numerator: i64,
    context_denominator: i64,
    context_observed: usize,
    latest_observed_at: Option<String>,
}

#[derive(Debug)]
struct CostAggregate {
    layers: Vec<Value>,
    best: Vec<Value>,
    observed_runs: usize,
    latest_observed_at: Option<String>,
}

fn build_usage_view(
    filter: &MonitoringFilter,
    window: &CollectionWindow,
    usage: &UsageAggregate,
) -> Value {
    json!({
        "schemaVersion": MONITORING_SCHEMA_VERSION,
        "collection": window.as_json(),
        "filter": filter,
        "inputTokens": usage.input_tokens,
        "outputTokens": usage.output_tokens,
        "reasoningOutputTokens": usage.reasoning_output_tokens,
        "cacheReadInputTokens": usage.cache_read_input_tokens,
        "cacheWriteInputTokens": usage.cache_write_input_tokens,
        "cacheReadTokenShare": usage.cache_read_token_share,
        "requestCacheHitRate": unavailable_metric(
            usage.cache_observable_run_count,
            "model_call_boundary_unavailable",
            "normalized_runtime"
        ),
        "cacheReadWriteAmortization": usage.cache_read_write_amortization,
        "contextUsageRate": usage.context_usage_rate,
        "cacheSavingsEstimate": unavailable_metric(
            usage.cache_observable_run_count,
            "price_catalog_unavailable",
            "price_catalog"
        ),
        "costLayers": usage.cost_layers,
        "byRuntimeAndModel": usage.by_runtime_and_model,
    })
}

fn load_usage_scalar(
    connection: &Connection,
    filter: &MonitoringFilter,
    window: &CollectionWindow,
) -> Result<UsageScalar> {
    let (scope, values) = scope_clause(filter, window);
    let sql = format!(
        r#"
        WITH logical AS (
            SELECT e.agent_run_id, e.collection_epoch
            FROM monitoring_run_enrollment e
            JOIN agent_run ar ON ar.id = e.agent_run_id
            WHERE {scope}
              AND e.execution_epoch = (
                  SELECT MIN(candidate.execution_epoch)
                  FROM monitoring_run_enrollment candidate
                  WHERE candidate.collection_epoch = e.collection_epoch
                    AND candidate.agent_run_id = e.agent_run_id
              )
        ), scoped AS (
            SELECT rollup.*
            FROM logical
            JOIN runtime_usage_run_rollup rollup
              ON rollup.collection_epoch = logical.collection_epoch
             AND rollup.agent_run_id = logical.agent_run_id
        ), context_ranked AS (
            SELECT agent_run_id, context_used_tokens, context_size_tokens,
                   ROW_NUMBER() OVER (
                       PARTITION BY agent_run_id
                       ORDER BY COALESCE(context_observed_at, latest_observed_at) DESC,
                                execution_epoch DESC
                   ) AS observation_rank
            FROM scoped
            WHERE context_used_tokens IS NOT NULL
               OR context_size_tokens IS NOT NULL
        ), valid_context AS (
            SELECT context_used_tokens, context_size_tokens
            FROM context_ranked
            WHERE observation_rank = 1
              AND context_used_tokens IS NOT NULL
              AND context_size_tokens > 0
              AND context_used_tokens <= context_size_tokens
        ), cache_read_write_runs AS (
            SELECT agent_run_id
            FROM scoped
            GROUP BY agent_run_id
            HAVING MAX(cache_read_input_tokens IS NOT NULL) = 1
               AND MAX(cache_write_input_tokens IS NOT NULL) = 1
        )
        SELECT
            SUM(CASE WHEN input_tokens IS NOT NULL
                           AND cache_read_input_tokens IS NOT NULL
                           AND cache_write_input_tokens IS NOT NULL
                     THEN input_tokens + cache_read_input_tokens
                          + cache_write_input_tokens END),
            COUNT(DISTINCT CASE WHEN input_tokens IS NOT NULL
                                      AND cache_read_input_tokens IS NOT NULL
                                      AND cache_write_input_tokens IS NOT NULL
                                THEN agent_run_id END),
            SUM(output_tokens),
            COUNT(DISTINCT CASE WHEN output_tokens IS NOT NULL THEN agent_run_id END),
            SUM(reasoning_output_tokens),
            COUNT(DISTINCT CASE WHEN reasoning_output_tokens IS NOT NULL
                                THEN agent_run_id END),
            SUM(cache_read_input_tokens),
            COUNT(DISTINCT CASE WHEN cache_read_input_tokens IS NOT NULL
                                THEN agent_run_id END),
            SUM(cache_write_input_tokens),
            COUNT(DISTINCT CASE WHEN cache_write_input_tokens IS NOT NULL
                                THEN agent_run_id END),
            COALESCE(SUM(CASE WHEN input_tokens IS NOT NULL
                                   AND cache_read_input_tokens IS NOT NULL
                                   AND cache_write_input_tokens IS NOT NULL
                              THEN cache_read_input_tokens END), 0),
            COALESCE(SUM(CASE WHEN input_tokens IS NOT NULL
                                   AND cache_read_input_tokens IS NOT NULL
                                   AND cache_write_input_tokens IS NOT NULL
                              THEN input_tokens + cache_read_input_tokens
                                   + cache_write_input_tokens END), 0),
            COUNT(DISTINCT CASE WHEN input_tokens IS NOT NULL
                                      AND cache_read_input_tokens IS NOT NULL
                                      AND cache_write_input_tokens IS NOT NULL
                                THEN agent_run_id END),
            (SELECT COUNT(*) FROM cache_read_write_runs),
            (SELECT COALESCE(SUM(context_used_tokens), 0) FROM valid_context),
            (SELECT COALESCE(SUM(context_size_tokens), 0) FROM valid_context),
            (SELECT COUNT(*) FROM valid_context),
            MAX(latest_observed_at)
        FROM scoped
        "#
    );
    connection
        .query_row(&sql, params_from_iter(values), |row| {
            Ok(UsageScalar {
                input_sum: row.get(0)?,
                input_observed: row.get::<_, i64>(1)? as usize,
                output_sum: row.get(2)?,
                output_observed: row.get::<_, i64>(3)? as usize,
                reasoning_sum: row.get(4)?,
                reasoning_observed: row.get::<_, i64>(5)? as usize,
                cache_read_sum: row.get(6)?,
                cache_read_observed: row.get::<_, i64>(7)? as usize,
                cache_write_sum: row.get(8)?,
                cache_write_observed: row.get::<_, i64>(9)? as usize,
                cache_share_numerator: row.get(10)?,
                cache_share_denominator: row.get(11)?,
                cache_share_observed: row.get::<_, i64>(12)? as usize,
                cache_read_write_observed: row.get::<_, i64>(13)? as usize,
                context_numerator: row.get(14)?,
                context_denominator: row.get(15)?,
                context_observed: row.get::<_, i64>(16)? as usize,
                latest_observed_at: row.get(17)?,
            })
        })
        .map_err(Into::into)
}

fn load_usage_breakdown(
    connection: &Connection,
    filter: &MonitoringFilter,
    window: &CollectionWindow,
) -> Result<Vec<Value>> {
    let (scope, values) = scope_clause(filter, window);
    let sql = format!(
        r#"
        WITH logical AS (
            SELECT e.agent_run_id, e.collection_epoch, e.adapter_kind,
                   COALESCE(e.model_id, 'unknown') AS model_id
            FROM monitoring_run_enrollment e
            JOIN agent_run ar ON ar.id = e.agent_run_id
            WHERE {scope}
              AND e.execution_epoch = (
                  SELECT MIN(candidate.execution_epoch)
                  FROM monitoring_run_enrollment candidate
                  WHERE candidate.collection_epoch = e.collection_epoch
                    AND candidate.agent_run_id = e.agent_run_id
              )
        ), eligible AS (
            SELECT adapter_kind, model_id, COUNT(*) AS eligible_count
            FROM logical
            GROUP BY adapter_kind, model_id
        ), scoped AS (
            SELECT logical.adapter_kind, logical.model_id,
                   rollup.agent_run_id, rollup.input_tokens,
                   rollup.output_tokens, rollup.reasoning_output_tokens,
                   rollup.cache_read_input_tokens,
                   rollup.cache_write_input_tokens
            FROM logical
            JOIN runtime_usage_run_rollup rollup
              ON rollup.collection_epoch = logical.collection_epoch
             AND rollup.agent_run_id = logical.agent_run_id
        ), observed AS (
            SELECT adapter_kind, model_id,
                   COUNT(DISTINCT agent_run_id) AS observed_count,
                   SUM(CASE WHEN input_tokens IS NOT NULL
                                  AND cache_read_input_tokens IS NOT NULL
                                  AND cache_write_input_tokens IS NOT NULL
                            THEN input_tokens + cache_read_input_tokens
                                 + cache_write_input_tokens END) AS input_tokens,
                   SUM(output_tokens) AS output_tokens,
                   SUM(reasoning_output_tokens) AS reasoning_output_tokens,
                   SUM(cache_read_input_tokens) AS cache_read_input_tokens,
                   SUM(cache_write_input_tokens) AS cache_write_input_tokens
            FROM scoped
            GROUP BY adapter_kind, model_id
        )
        SELECT observed.adapter_kind, observed.model_id,
               observed.observed_count, eligible.eligible_count,
               observed.input_tokens, observed.output_tokens,
               observed.reasoning_output_tokens,
               observed.cache_read_input_tokens,
               observed.cache_write_input_tokens
        FROM observed
        JOIN eligible USING(adapter_kind, model_id)
        ORDER BY observed.adapter_kind, observed.model_id
        "#
    );
    let mut statement = connection.prepare(&sql)?;
    statement
        .query_map(params_from_iter(values), |row| {
            let observed = row.get::<_, i64>(2)? as usize;
            let eligible = (row.get::<_, i64>(3)? as usize).max(observed);
            Ok(json!({
                "adapterKind": row.get::<_, String>(0)?,
                "modelId": row.get::<_, String>(1)?,
                "observedRunCount": observed,
                "eligibleRunCount": eligible,
                "coverage": (eligible > 0)
                    .then_some(observed as f64 / eligible as f64),
                "inputTokens": row.get::<_, Option<i64>>(4)?,
                "outputTokens": row.get::<_, Option<i64>>(5)?,
                "reasoningOutputTokens": row.get::<_, Option<i64>>(6)?,
                "cacheReadInputTokens": row.get::<_, Option<i64>>(7)?,
                "cacheWriteInputTokens": row.get::<_, Option<i64>>(8)?,
            }))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn load_cost_aggregates(
    connection: &Connection,
    filter: &MonitoringFilter,
    window: &CollectionWindow,
    eligible_runs: usize,
) -> Result<CostAggregate> {
    let (scope, values) = scope_clause(filter, window);
    let layer_sql = format!(
        r#"
        WITH logical AS (
            SELECT e.agent_run_id, e.collection_epoch
            FROM monitoring_run_enrollment e
            JOIN agent_run ar ON ar.id = e.agent_run_id
            WHERE {scope}
              AND e.execution_epoch = (
                  SELECT MIN(candidate.execution_epoch)
                  FROM monitoring_run_enrollment candidate
                  WHERE candidate.collection_epoch = e.collection_epoch
                    AND candidate.agent_run_id = e.agent_run_id
              )
        ), scoped AS (
            SELECT cost.*
            FROM logical
            JOIN runtime_cost_run_rollup cost
              ON cost.collection_epoch = logical.collection_epoch
             AND cost.agent_run_id = logical.agent_run_id
        ), values_by_currency AS (
            SELECT quality, grain, currency,
                   rovai_decimal_sum(amount_decimal) AS amount_decimal
            FROM scoped
            GROUP BY quality, grain, currency
        ), layer_summary AS (
            SELECT quality, grain,
                   COUNT(DISTINCT agent_run_id) AS observed_count
            FROM scoped
            GROUP BY quality, grain
        )
        SELECT values_by_currency.quality, values_by_currency.grain,
               values_by_currency.currency, values_by_currency.amount_decimal,
               layer_summary.observed_count
        FROM values_by_currency
        JOIN layer_summary USING(quality, grain)
        ORDER BY values_by_currency.quality, values_by_currency.grain,
                 values_by_currency.currency
        "#
    );
    let mut statement = connection.prepare(&layer_sql)?;
    let layer_rows = statement
        .query_map(params_from_iter(values), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)? as usize,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut layers = BTreeMap::<(String, String), (Vec<Value>, usize)>::new();
    for (quality, grain, currency, amount, observed) in layer_rows {
        let entry = layers
            .entry((quality.clone(), grain.clone()))
            .or_insert_with(|| (Vec::new(), observed));
        entry.0.push(json!({
            "amount": amount,
            "currency": currency,
            "quality": quality,
            "grain": grain,
            "pricingCatalogVersion": Value::Null,
            "reconciledThrough": Value::Null,
        }));
    }
    let cost_layers = layers
        .into_iter()
        .map(|((quality, grain), (values, observed_count))| {
            let eligible_count = eligible_runs.max(observed_count);
            json!({
                "quality": quality,
                "grain": grain,
                "values": values,
                "observedCount": observed_count,
                "eligibleCount": eligible_count,
                "coverage": (eligible_count > 0)
                    .then_some(observed_count as f64 / eligible_count as f64),
            })
        })
        .collect::<Vec<_>>();

    let (scope, values) = scope_clause(filter, window);
    let best_sql = format!(
        r#"
        WITH logical AS (
            SELECT e.agent_run_id, e.collection_epoch
            FROM monitoring_run_enrollment e
            JOIN agent_run ar ON ar.id = e.agent_run_id
            WHERE {scope}
              AND e.execution_epoch = (
                  SELECT MIN(candidate.execution_epoch)
                  FROM monitoring_run_enrollment candidate
                  WHERE candidate.collection_epoch = e.collection_epoch
                    AND candidate.agent_run_id = e.agent_run_id
              )
        ), scoped AS (
            SELECT cost.*
            FROM logical
            JOIN runtime_cost_run_rollup cost
              ON cost.collection_epoch = logical.collection_epoch
             AND cost.agent_run_id = logical.agent_run_id
        ), per_run_layer AS (
            SELECT agent_run_id, currency, grain, quality,
                   rovai_decimal_sum(amount_decimal) AS amount_decimal,
                   MAX(latest_observed_at) AS latest_observed_at,
                   CASE quality
                       WHEN 'provider_reconciled' THEN 5
                       WHEN 'runtime_reported' THEN 4
                       WHEN 'runtime_estimate' THEN 3
                       WHEN 'price_estimated' THEN 2
                       WHEN 'tokenizer_price_estimated' THEN 1
                       ELSE 0
                   END AS quality_rank
            FROM scoped
            GROUP BY agent_run_id, currency, grain, quality
        ), ranked AS (
            SELECT *, ROW_NUMBER() OVER (
                PARTITION BY agent_run_id, currency, grain
                ORDER BY quality_rank DESC
            ) AS choice_rank
            FROM per_run_layer
            WHERE quality_rank > 0
        ), selected AS (
            SELECT * FROM ranked WHERE choice_rank = 1
        ), aggregated AS (
            SELECT currency, grain, quality,
                   rovai_decimal_sum(amount_decimal) AS amount_decimal
            FROM selected
            GROUP BY currency, grain, quality
        )
        SELECT aggregated.currency, aggregated.grain, aggregated.quality,
               aggregated.amount_decimal,
               (SELECT COUNT(DISTINCT agent_run_id) FROM selected),
               (SELECT MAX(latest_observed_at) FROM selected)
        FROM aggregated
        ORDER BY aggregated.currency, aggregated.grain, aggregated.quality
        "#
    );
    let mut statement = connection.prepare(&best_sql)?;
    let mut observed_runs = 0_usize;
    let mut latest_observed_at = None;
    let best_cost = statement
        .query_map(params_from_iter(values), |row| {
            Ok((
                json!({
                    "amount": row.get::<_, String>(3)?,
                    "currency": row.get::<_, String>(0)?,
                    "quality": row.get::<_, String>(2)?,
                    "grain": row.get::<_, String>(1)?,
                    "pricingCatalogVersion": Value::Null,
                    "reconciledThrough": Value::Null,
                }),
                row.get::<_, i64>(4)? as usize,
                row.get::<_, Option<String>>(5)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .into_iter()
        .map(|(value, count, latest)| {
            observed_runs = count;
            latest_observed_at = latest;
            value
        })
        .collect::<Vec<_>>();
    Ok(CostAggregate {
        layers: cost_layers,
        best: best_cost,
        observed_runs,
        latest_observed_at,
    })
}

fn aggregate_usage(
    connection: &Connection,
    filter: &MonitoringFilter,
    window: &CollectionWindow,
    runs: &RunAggregate,
) -> Result<UsageAggregate> {
    let usage = load_usage_scalar(connection, filter, window)?;
    let by_runtime_and_model = load_usage_breakdown(connection, filter, window)?;
    let cost = load_cost_aggregates(connection, filter, window, runs.cost_eligible)?;
    let latest = usage.latest_observed_at.clone();
    let cache_read_sum = usage.cache_read_sum.unwrap_or(0);
    let cache_write_sum = usage.cache_write_sum.unwrap_or(0);
    let cache_read_write_amortization = if cache_write_sum > 0 {
        ratio_metric(
            cache_read_sum,
            cache_write_sum,
            (usage.cache_read_write_observed, runs.cache_observable),
            "normalized_runtime",
            &["runtime_reported", "normalized"],
            latest.clone(),
            "cache_write_zero",
        )
    } else {
        metric(
            None,
            usage.cache_read_write_observed,
            runs.cache_observable,
            "normalized_runtime",
            &["runtime_reported", "normalized"],
            latest.clone(),
            Some(if cache_read_sum > 0 {
                "cache_write_zero"
            } else {
                "no_cache_write_observations"
            }),
        )
    };

    Ok(UsageAggregate {
        input_tokens: metric(
            usage.input_sum.map(|value| json!(value)),
            usage.input_observed,
            runs.input_eligible,
            "normalized_runtime",
            &["runtime_reported", "normalized"],
            latest.clone(),
            None,
        ),
        output_tokens: metric(
            usage.output_sum.map(|value| json!(value)),
            usage.output_observed,
            runs.output_eligible,
            "normalized_runtime",
            &["runtime_reported", "normalized"],
            latest.clone(),
            None,
        ),
        reasoning_output_tokens: metric(
            usage.reasoning_sum.map(|value| json!(value)),
            usage.reasoning_observed,
            runs.reasoning_eligible,
            "normalized_runtime",
            &["runtime_reported", "normalized"],
            latest.clone(),
            None,
        ),
        cache_read_input_tokens: metric(
            usage.cache_read_sum.map(|value| json!(value)),
            usage.cache_read_observed,
            runs.cache_read_eligible,
            "normalized_runtime",
            &["runtime_reported", "normalized"],
            latest.clone(),
            None,
        ),
        cache_write_input_tokens: metric(
            usage.cache_write_sum.map(|value| json!(value)),
            usage.cache_write_observed,
            runs.cache_write_eligible,
            "normalized_runtime",
            &["runtime_reported", "normalized"],
            latest.clone(),
            None,
        ),
        cache_read_token_share: ratio_metric(
            usage.cache_share_numerator,
            usage.cache_share_denominator,
            (usage.cache_share_observed, runs.cache_observable),
            "normalized_runtime",
            &["runtime_reported", "normalized"],
            latest.clone(),
            "cache_denominator_zero",
        ),
        cache_read_write_amortization,
        context_usage_rate: ratio_metric(
            usage.context_numerator,
            usage.context_denominator,
            (usage.context_observed, runs.context_eligible),
            "runtime_native",
            &["runtime_reported"],
            latest.clone(),
            "context_window_zero",
        ),
        cost_layers: cost.layers,
        by_runtime_and_model,
        best_cost: cost.best,
        cost_observed_runs: cost.observed_runs,
        cost_eligible_runs: runs.cost_eligible,
        cost_latest_observed_at: cost.latest_observed_at,
        cache_observable_run_count: runs.cache_observable,
    })
}

fn add_decimal(left: &str, right: &str) -> Result<String> {
    validate_decimal(left)?;
    validate_decimal(right)?;
    let (left_whole, left_fraction) = decimal_parts(left);
    let (right_whole, right_fraction) = decimal_parts(right);
    let scale = left_fraction.len().max(right_fraction.len());
    let left_digits = format!("{left_whole}{:0<width$}", left_fraction, width = scale);
    let right_digits = format!("{right_whole}{:0<width$}", right_fraction, width = scale);
    let width = left_digits.len().max(right_digits.len());
    let mut carry = 0_u8;
    let mut result = Vec::with_capacity(width + 1);
    let left_bytes = format!("{left_digits:0>width$}").into_bytes();
    let right_bytes = format!("{right_digits:0>width$}").into_bytes();
    for index in (0..width).rev() {
        let sum = (left_bytes[index] - b'0') + (right_bytes[index] - b'0') + carry;
        result.push((sum % 10) + b'0');
        carry = sum / 10;
    }
    if carry > 0 {
        result.push(carry + b'0');
    }
    result.reverse();
    let mut digits = String::from_utf8(result).context("decimal sum is not UTF-8")?;
    if scale > 0 {
        if digits.len() <= scale {
            digits = format!("{digits:0>width$}", width = scale + 1);
        }
        digits.insert(digits.len() - scale, '.');
        while digits.ends_with('0') {
            digits.pop();
        }
        if digits.ends_with('.') {
            digits.pop();
        }
    }
    let trimmed = digits.trim_start_matches('0');
    Ok(if trimmed.is_empty() {
        "0".to_string()
    } else if trimmed.starts_with('.') {
        format!("0{trimmed}")
    } else {
        trimmed.to_string()
    })
}

fn decimal_parts(value: &str) -> (&str, &str) {
    value.split_once('.').unwrap_or((value, ""))
}

struct SessionAggregate {
    fact_count: i64,
    requested: i64,
    settled_resume_attempts: i64,
    succeeded: i64,
    new_sessions: i64,
    rejected: i64,
    incompatible: i64,
    ambiguous: i64,
    failed: i64,
    fallback_to_new_session: i64,
    unresolved: i64,
    latest_observed_at: Option<String>,
}

fn session_summary(
    connection: &Connection,
    filter: &MonitoringFilter,
    window: &CollectionWindow,
) -> Result<Value> {
    let (scope, values) = scope_clause(filter, window);
    let sql = format!(
        r#"
        SELECT COUNT(*),
               COALESCE(SUM(fact.resume_requested), 0),
               COALESCE(SUM(
                   fact.resume_requested = 1
                   AND fact.resume_outcome <> 'not_attempted'
               ), 0),
               COALESCE(SUM(fact.resume_outcome = 'succeeded'), 0),
               COALESCE(SUM(fact.resume_disposition = 'new'), 0),
               COALESCE(SUM(fact.resume_outcome = 'rejected'), 0),
               COALESCE(SUM(fact.resume_outcome = 'incompatible'), 0),
               COALESCE(SUM(fact.resume_outcome = 'ambiguous'), 0),
               COALESCE(SUM(fact.resume_outcome = 'failed'), 0),
               COALESCE(SUM(fact.fallback_to_new_session), 0),
               COALESCE(SUM(
                   fact.resume_requested = 1
                   AND fact.resume_outcome = 'not_attempted'
               ), 0),
               MAX(fact.updated_at)
        FROM agent_run_native_session_fact fact
        JOIN monitoring_run_enrollment e
          ON e.agent_run_id = fact.agent_run_id
         AND e.execution_epoch = fact.execution_epoch
        JOIN agent_run ar ON ar.id = e.agent_run_id
        WHERE {scope}
          AND ar.status IN ('succeeded', 'failed', 'cancelled')
        "#
    );
    let aggregate = connection.query_row(&sql, params_from_iter(values), |row| {
        Ok(SessionAggregate {
            fact_count: row.get(0)?,
            requested: row.get(1)?,
            settled_resume_attempts: row.get(2)?,
            succeeded: row.get(3)?,
            new_sessions: row.get(4)?,
            rejected: row.get(5)?,
            incompatible: row.get(6)?,
            ambiguous: row.get(7)?,
            failed: row.get(8)?,
            fallback_to_new_session: row.get(9)?,
            unresolved: row.get(10)?,
            latest_observed_at: row.get(11)?,
        })
    })?;
    Ok(json!({
        "continuationRate": ratio_metric(
            aggregate.succeeded,
            aggregate.settled_resume_attempts,
            (
                aggregate.settled_resume_attempts as usize,
                aggregate.requested as usize
            ),
            "core_fact",
            &["authoritative_core"],
            aggregate.latest_observed_at,
            "no_settled_resume_attempts"
        ),
        "eligibleRuns": aggregate.requested,
        "factCount": aggregate.fact_count,
        "resumeRequested": aggregate.requested,
        "succeeded": aggregate.succeeded,
        "newSessions": aggregate.new_sessions,
        "rejected": aggregate.rejected,
        "incompatible": aggregate.incompatible,
        "ambiguous": aggregate.ambiguous,
        "failed": aggregate.failed,
        "fallbackToNewSession": aggregate.fallback_to_new_session,
        "unresolved": aggregate.unresolved,
    }))
}

fn build_reliability(
    connection: &Connection,
    filter: &MonitoringFilter,
    window: &CollectionWindow,
    runs: &RunAggregate,
    usage: &UsageAggregate,
    session: &Value,
    attention: &Value,
) -> Result<Value> {
    let latest = runs.latest_observed_at.clone();
    let (input_acceptance, first_visible_activity, accepted_delivery_count) =
        delivery_latency_metrics(connection, filter, window, runs.total)?;
    let approval = approval_summary(connection, filter, window)?;
    let tool_duration = tool_duration_summary(connection, filter, window)?;
    let activity = activity_coverage_summary(runs);
    let compaction = compaction_summary(connection, filter, window, runs)?;
    let context = json!({
        "usageRate": usage.context_usage_rate,
        "deliveryAcceptedRuns": accepted_delivery_count,
        "deliveryCoverage": (runs.total > 0)
            .then_some(accepted_delivery_count as f64 / runs.total as f64),
    });
    let runtime_health = runs
        .by_runtime
        .iter()
        .map(|runtime| {
            json!({
                "adapterKind": runtime.adapter_kind,
                "runCount": runtime.total,
                "activeRunCount": runtime.active,
                "failedRunCount": runtime.failed,
                "latestErrorCode": runtime.last_error_code,
                "latestObservedAt": runtime.latest_observed_at,
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "schemaVersion": MONITORING_SCHEMA_VERSION,
        "collection": window.as_json(),
        "filter": filter,
        "queueP95Millis": metric(
            runs.queue_p95_millis.map(|value| json!(value)),
            runs.queue_observed,
            runs.total,
            "core_fact",
            &["authoritative_core"],
            latest.clone(),
            None
        ),
        "inputAcceptanceP95Millis": input_acceptance,
        "firstVisibleActivityP95Millis": first_visible_activity,
        "executionP95Millis": metric(
            runs.execution_p95_millis.map(|value| json!(value)),
            runs.execution_observed,
            runs.terminal,
            "core_fact",
            &["authoritative_core"],
            latest.clone(),
            None
        ),
        "endToEndP95Millis": metric(
            runs.end_to_end_p95_millis.map(|value| json!(value)),
            runs.end_to_end_observed,
            runs.terminal,
            "core_fact",
            &["authoritative_core"],
            latest,
            None
        ),
        "session": session,
        "context": context,
        "approval": approval,
        "toolDuration": tool_duration,
        "activity": activity,
        "compaction": compaction,
        "runtimeHealth": runtime_health,
        "attention": attention,
    }))
}

struct DeliveryLatencyAggregate {
    accepted_runs: usize,
    input_observed: usize,
    input_p95_millis: Option<i64>,
    input_latest_observed_at: Option<String>,
    visible_observed: usize,
    visible_p95_millis: Option<i64>,
    visible_latest_observed_at: Option<String>,
}

fn delivery_latency_metrics(
    connection: &Connection,
    filter: &MonitoringFilter,
    window: &CollectionWindow,
    eligible_runs: usize,
) -> Result<(Value, Value, usize)> {
    let (scope, values) = scope_clause(filter, window);
    let sql = format!(
        r#"
        WITH candidates AS (
            SELECT delivery.agent_run_id, delivery.prepared_at,
                   delivery.accepted_at,
                   (
                       SELECT MIN(activity.first_visible_activity_at)
                       FROM monitoring_run_enrollment activity
                       WHERE activity.collection_epoch = e.collection_epoch
                         AND activity.agent_run_id = delivery.agent_run_id
                   ) AS first_visible_activity_at,
                   ROW_NUMBER() OVER (
                       PARTITION BY delivery.agent_run_id
                       ORDER BY delivery.accepted_at, delivery.id
                   ) AS delivery_rank
            FROM runtime_input_delivery delivery
            JOIN monitoring_run_enrollment e
              ON e.agent_run_id = delivery.agent_run_id
             AND e.execution_epoch = delivery.execution_epoch
            JOIN agent_run ar ON ar.id = e.agent_run_id
            WHERE {scope}
              AND delivery.status = 'accepted'
              AND delivery.accepted_at IS NOT NULL
        ), scoped AS (
            SELECT agent_run_id, accepted_at, first_visible_activity_at,
                   CAST(ROUND(
                       (julianday(accepted_at) - julianday(prepared_at))
                       * 86400000.0
                   ) AS INTEGER) AS input_millis,
                   CAST(ROUND(
                       (julianday(first_visible_activity_at) - julianday(accepted_at))
                       * 86400000.0
                   ) AS INTEGER) AS visible_millis
            FROM candidates
            WHERE delivery_rank = 1
        ), valid_input AS (
            SELECT * FROM scoped WHERE input_millis >= 0
        ), ranked_input AS (
            SELECT input_millis,
                   ROW_NUMBER() OVER (ORDER BY input_millis) AS sample_rank,
                   COUNT(*) OVER () AS sample_count
            FROM valid_input
        ), valid_visible AS (
            SELECT * FROM scoped WHERE visible_millis >= 0
        ), ranked_visible AS (
            SELECT visible_millis,
                   ROW_NUMBER() OVER (ORDER BY visible_millis) AS sample_rank,
                   COUNT(*) OVER () AS sample_count
            FROM valid_visible
        )
        SELECT
            (SELECT COUNT(*) FROM scoped),
            (SELECT COUNT(*) FROM valid_input),
            (SELECT input_millis FROM ranked_input
             WHERE sample_rank = (sample_count * 95 + 99) / 100),
            (SELECT MAX(accepted_at) FROM valid_input),
            (SELECT COUNT(*) FROM valid_visible),
            (SELECT visible_millis FROM ranked_visible
             WHERE sample_rank = (sample_count * 95 + 99) / 100),
            (SELECT MAX(first_visible_activity_at) FROM valid_visible)
        "#
    );
    let aggregate = connection.query_row(&sql, params_from_iter(values), |row| {
        Ok(DeliveryLatencyAggregate {
            accepted_runs: row.get::<_, i64>(0)? as usize,
            input_observed: row.get::<_, i64>(1)? as usize,
            input_p95_millis: row.get(2)?,
            input_latest_observed_at: row.get(3)?,
            visible_observed: row.get::<_, i64>(4)? as usize,
            visible_p95_millis: row.get(5)?,
            visible_latest_observed_at: row.get(6)?,
        })
    })?;
    let eligible_runs = eligible_runs.max(aggregate.accepted_runs);
    Ok((
        metric(
            aggregate.input_p95_millis.map(|value| json!(value)),
            aggregate.input_observed,
            eligible_runs,
            "core_fact",
            &["authoritative_core"],
            aggregate.input_latest_observed_at,
            None,
        ),
        metric(
            aggregate.visible_p95_millis.map(|value| json!(value)),
            aggregate.visible_observed,
            aggregate.accepted_runs,
            "core_fact",
            &["authoritative_core"],
            aggregate.visible_latest_observed_at,
            None,
        ),
        aggregate.accepted_runs,
    ))
}

fn approval_summary(
    connection: &Connection,
    filter: &MonitoringFilter,
    window: &CollectionWindow,
) -> Result<Value> {
    let (scope, mut values) = scope_clause(filter, window);
    values.insert(0, SqlValue::Text(window.observed_at.clone()));
    let sql = format!(
        r#"
        WITH scoped AS (
            SELECT approval.status, approval.requested_at,
                   approval.resolved_at,
                   CASE
                       WHEN approval.resolved_at IS NOT NULL
                           THEN approval.resolved_at
                       WHEN approval.status = 'pending' THEN ?
                       ELSE NULL
                   END AS wait_ended_at
            FROM approval
            JOIN action_execution action ON action.id = approval.action_id
            JOIN monitoring_run_enrollment e
              ON e.agent_run_id = action.agent_run_id
             AND e.execution_epoch = action.source_agent_run_execution_epoch
            JOIN agent_run ar ON ar.id = e.agent_run_id
            WHERE {scope}
        ), sampled AS (
            SELECT status, requested_at, resolved_at,
                   CAST(ROUND(
                       (julianday(wait_ended_at) - julianday(requested_at))
                       * 86400000.0
                   ) AS INTEGER) AS wait_millis
            FROM scoped
            WHERE wait_ended_at IS NOT NULL
        ), valid AS (
            SELECT * FROM sampled WHERE wait_millis >= 0
        ), ranked AS (
            SELECT wait_millis,
                   ROW_NUMBER() OVER (ORDER BY wait_millis) AS sample_rank,
                   COUNT(*) OVER () AS sample_count
            FROM valid
        )
        SELECT
            (SELECT COUNT(*) FROM scoped),
            (SELECT COUNT(*) FROM scoped WHERE resolved_at IS NOT NULL),
            (SELECT COUNT(*) FROM scoped
             WHERE status = 'pending' AND resolved_at IS NULL),
            (SELECT wait_millis FROM ranked
             WHERE sample_rank = (sample_count * 95 + 99) / 100),
            (SELECT COUNT(*) FROM valid),
            (SELECT MAX(requested_at) FROM scoped)
        "#
    );
    let (requested, resolved, pending, wait_p95, wait_observed, latest): (
        i64,
        i64,
        i64,
        Option<i64>,
        i64,
        Option<String>,
    ) = connection.query_row(&sql, params_from_iter(values), |row| {
        Ok((
            row.get(0)?,
            row.get(1)?,
            row.get(2)?,
            row.get(3)?,
            row.get(4)?,
            row.get(5)?,
        ))
    })?;
    Ok(json!({
        "requested": requested,
        "resolved": resolved,
        "pending": pending,
        "waitP95Millis": metric(
            wait_p95.map(|value| json!(value)),
            wait_observed as usize,
            requested as usize,
            "core_fact",
            &["authoritative_core"],
            latest,
            None
        ),
    }))
}

fn tool_duration_summary(
    connection: &Connection,
    filter: &MonitoringFilter,
    window: &CollectionWindow,
) -> Result<Value> {
    let (scope, mut values) = scope_clause(filter, window);
    values.push(SqlValue::Text(
        crate::canonical_activity::CLASSIFIER_VERSION.to_string(),
    ));
    let sql = format!(
        r#"
        WITH scoped AS (
            SELECT activity.agent_run_id, activity.outcome,
                   activity.coverage_level, activity.started_at,
                   activity.terminal_at,
                   CAST(ROUND(julianday(activity.started_at) * 86400000.0)
                       AS INTEGER) AS started_millis,
                   CAST(ROUND(julianday(activity.terminal_at) * 86400000.0)
                       AS INTEGER) AS terminal_millis
            FROM canonical_runtime_activity activity
            JOIN monitoring_run_enrollment e
              ON e.agent_run_id = activity.agent_run_id
             AND e.execution_epoch = activity.execution_epoch
            JOIN agent_run ar ON ar.id = e.agent_run_id
            WHERE {scope}
              AND activity.activity_domain IN ('tool', 'shell', 'file')
              AND activity.classifier_version = ?
        ), paired AS (
            SELECT agent_run_id, started_millis, terminal_millis
            FROM scoped
            WHERE coverage_level = 'fine_grained'
              AND outcome <> 'unsettled'
              AND started_millis IS NOT NULL
              AND terminal_millis IS NOT NULL
              AND terminal_millis >= started_millis
        ), ordered AS (
            SELECT *,
                   MAX(terminal_millis) OVER (
                       PARTITION BY agent_run_id
                       ORDER BY started_millis, terminal_millis
                       ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                   ) AS prior_terminal_millis
            FROM paired
        ), marked AS (
            SELECT *,
                   CASE
                       WHEN prior_terminal_millis IS NULL
                         OR started_millis > prior_terminal_millis THEN 1
                       ELSE 0
                   END AS starts_island
            FROM ordered
        ), grouped AS (
            SELECT *,
                   SUM(starts_island) OVER (
                       PARTITION BY agent_run_id
                       ORDER BY started_millis, terminal_millis
                       ROWS UNBOUNDED PRECEDING
                   ) AS island_id
            FROM marked
        ), merged AS (
            SELECT agent_run_id, island_id,
                   MIN(started_millis) AS started_millis,
                   MAX(terminal_millis) AS terminal_millis
            FROM grouped
            GROUP BY agent_run_id, island_id
        )
        SELECT
            (SELECT COUNT(*) FROM scoped),
            (SELECT COUNT(*) FROM scoped
             WHERE coverage_level = 'fine_grained'),
            (SELECT COUNT(*) FROM paired),
            (SELECT COALESCE(SUM(terminal_millis - started_millis), 0)
             FROM paired),
            (SELECT COALESCE(SUM(terminal_millis - started_millis), 0)
             FROM merged),
            (SELECT COUNT(*) FROM scoped
             WHERE coverage_level = 'fine_grained'
               AND started_at IS NOT NULL AND terminal_at IS NULL),
            (SELECT COUNT(*) FROM scoped
             WHERE coverage_level = 'fine_grained'
               AND started_at IS NULL AND terminal_at IS NOT NULL),
            (SELECT COUNT(*) FROM scoped
             WHERE coverage_level = 'fine_grained'
               AND outcome = 'unsettled')
        "#
    );
    let (
        row_count,
        eligible,
        paired_count,
        paired_elapsed,
        wall_clock_union,
        unpaired_started,
        terminal_only,
        conflicting,
    ): (i64, i64, i64, i64, i64, i64, i64, i64) =
        connection.query_row(&sql, params_from_iter(values), |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
            ))
        })?;
    Ok(json!({
        "eligibleCalls": eligible,
        "pairedCalls": paired_count,
        "coverage": (eligible > 0).then_some(paired_count as f64 / eligible as f64),
        "pairedElapsedMillis": (paired_count > 0).then_some(paired_elapsed),
        "wallClockUnionMillis": (paired_count > 0).then_some(wall_clock_union),
        "unpairedStartedCalls": unpaired_started,
        "terminalOnlyCalls": terminal_only,
        "conflictingCalls": conflicting,
        "diagnosticCode": if row_count == 0 {
            Value::String("no_tool_activity".to_string())
        } else if eligible == 0 {
            Value::String("stable_tool_identity_unavailable".to_string())
        } else if conflicting > 0 {
            Value::String("conflicting_tool_terminal".to_string())
        } else {
            Value::Null
        },
    }))
}

#[cfg(test)]
fn interval_union_millis(intervals: &mut [(String, i64, i64)]) -> i64 {
    intervals.sort_unstable_by(|left, right| {
        (&left.0, left.1, left.2).cmp(&(&right.0, right.1, right.2))
    });
    let mut total = 0_i64;
    let mut current: Option<(&str, i64, i64)> = None;
    for (agent_run_id, started_at, terminal_at) in intervals.iter() {
        match current {
            Some((current_run_id, current_start, current_end))
                if current_run_id == agent_run_id && *started_at <= current_end =>
            {
                current = Some((current_run_id, current_start, current_end.max(*terminal_at)));
            }
            Some((_, current_start, current_end)) => {
                total += current_end - current_start;
                current = Some((agent_run_id.as_str(), *started_at, *terminal_at));
            }
            None => {
                current = Some((agent_run_id.as_str(), *started_at, *terminal_at));
            }
        }
    }
    if let Some((_, current_start, current_end)) = current {
        total += current_end - current_start;
    }
    total
}

fn activity_coverage_summary(runs: &RunAggregate) -> Value {
    json!({
        "runCoverage": metric(
            (runs.evidence_observed_runs > 0 && runs.total > 0).then(|| {
                json!(runs.evidence_observed_runs as f64 / runs.total as f64)
            }),
            runs.evidence_observed_runs,
            runs.total,
            "core_fact",
            &["authoritative_core"],
            runs.evidence_latest_observed_at.clone(),
            None
        ),
        "evidenceCount": runs.evidence_count,
    })
}

fn compaction_summary(
    connection: &Connection,
    filter: &MonitoringFilter,
    window: &CollectionWindow,
    runs: &RunAggregate,
) -> Result<Value> {
    let (scope, values) = scope_clause(filter, window);
    let sql = format!(
        r#"
        SELECT COUNT(DISTINCT e.agent_run_id),
               COUNT(DISTINCT observation.id),
               MAX(observation.observed_at)
        FROM monitoring_run_enrollment e
        JOIN agent_run ar ON ar.id = e.agent_run_id
        JOIN native_session_compaction_observer_lease lease
          ON lease.conversation_id = ar.conversation_id
        JOIN native_session_compaction_observation observation
          ON observation.observer_lease_id = lease.id
        WHERE {scope}
          AND observation.observed_at >= e.logical_enrolled_at
          AND observation.observed_at <= COALESCE(ar.ended_at, ?)
        "#
    );
    let mut values = values;
    values.push(SqlValue::Text(window.end_at.clone()));
    let (observed_runs, observation_count, latest): (i64, i64, Option<String>) = connection
        .query_row(&sql, params_from_iter(values), |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?;
    let eligible = runs.compaction_eligible;
    Ok(json!({
        "coverage": metric(
            (observed_runs > 0 && eligible > 0)
                .then(|| json!(observed_runs as f64 / eligible as f64)),
            observed_runs as usize,
            eligible,
            "core_fact",
            &["authoritative_core"],
            latest,
            None
        ),
        "observationCount": observation_count,
    }))
}

fn attention_summary(
    connection: &Connection,
    filter: &MonitoringFilter,
    window: &CollectionWindow,
    runs: &RunAggregate,
) -> Result<Value> {
    let (scope, values) = scope_clause(filter, window);
    let delivery_sql = format!(
        r#"
        SELECT COUNT(*)
        FROM runtime_input_delivery delivery
        JOIN monitoring_run_enrollment e
          ON e.agent_run_id = delivery.agent_run_id
         AND e.execution_epoch = delivery.execution_epoch
        JOIN agent_run ar ON ar.id = e.agent_run_id
        WHERE {scope} AND delivery.status = 'delivery_unknown'
        "#
    );
    let delivery_unknown: i64 =
        connection.query_row(&delivery_sql, params_from_iter(values), |row| row.get(0))?;
    let (scope, values) = scope_clause(filter, window);
    let approval_sql = format!(
        r#"
        SELECT COUNT(*)
        FROM approval
        JOIN action_execution action ON action.id = approval.action_id
        JOIN monitoring_run_enrollment e
          ON e.agent_run_id = action.agent_run_id
         AND e.execution_epoch = action.source_agent_run_execution_epoch
        JOIN agent_run ar ON ar.id = e.agent_run_id
        WHERE {scope} AND approval.status = 'pending'
        "#
    );
    let pending_approvals: i64 =
        connection.query_row(&approval_sql, params_from_iter(values), |row| row.get(0))?;
    let active_without_evidence = runs.active_without_evidence;
    Ok(json!({
        "total": active_without_evidence + delivery_unknown as usize
            + pending_approvals as usize,
        "activeWithoutVisibleActivity": active_without_evidence,
        "deliveryUnknown": delivery_unknown,
        "pendingApprovals": pending_approvals,
    }))
}

#[derive(Debug)]
struct NormalizedUsage {
    fields: RuntimeUsageFields,
    status: &'static str,
    diagnostic_code: Option<&'static str>,
}

fn normalize_usage(observation: &ParsedRuntimeUsage) -> NormalizedUsage {
    let mut fields = observation.fields.clone();
    match observation.input_semantics {
        RuntimeInputSemantics::ExclusiveBuckets => NormalizedUsage {
            fields,
            status: if observation.fields.is_empty() {
                "invalid"
            } else {
                "complete"
            },
            diagnostic_code: observation
                .fields
                .is_empty()
                .then_some("usage_fields_empty"),
        },
        RuntimeInputSemantics::CacheInclusiveTotal => {
            match (
                fields.input_tokens,
                fields.cache_read_input_tokens,
                fields.cache_write_input_tokens,
            ) {
                (Some(total), Some(read), Some(write)) if total >= read + write => {
                    fields.input_tokens = Some(total - read - write);
                    NormalizedUsage {
                        fields,
                        status: "complete",
                        diagnostic_code: None,
                    }
                }
                (Some(_), Some(_), Some(_)) => {
                    fields.input_tokens = None;
                    NormalizedUsage {
                        fields,
                        status: "invalid",
                        diagnostic_code: Some("cache_buckets_exceed_input"),
                    }
                }
                _ => {
                    fields.input_tokens = None;
                    NormalizedUsage {
                        fields,
                        status: "partial",
                        diagnostic_code: Some("cache_bucket_missing"),
                    }
                }
            }
        }
        RuntimeInputSemantics::Unknown => {
            fields.input_tokens = None;
            NormalizedUsage {
                fields,
                status: "partial",
                diagnostic_code: Some("input_semantics_unknown"),
            }
        }
    }
}

fn validate_usage(observation: &ParsedRuntimeUsage) -> Result<()> {
    if observation.identity_suffix.trim().is_empty() || observation.dialect_id.trim().is_empty() {
        anyhow::bail!("Runtime Usage source identity and dialect are required");
    }
    if !matches!(
        observation.source.as_str(),
        "runtime_event"
            | "runtime_result"
            | "runtime_private_extension"
            | "provider_usage_api"
            | "local_tokenizer"
    ) {
        anyhow::bail!("Runtime Usage source is unsupported");
    }
    if !matches!(
        observation.scope.as_str(),
        "model_call" | "turn" | "run" | "session"
    ) {
        anyhow::bail!("Runtime Usage scope is unsupported");
    }
    for value in [
        observation.fields.input_tokens,
        observation.fields.output_tokens,
        observation.fields.reasoning_output_tokens,
        observation.fields.cache_read_input_tokens,
        observation.fields.cache_write_input_tokens,
        observation.fields.context_used_tokens,
        observation.fields.context_size_tokens,
    ]
    .into_iter()
    .flatten()
    {
        if value < 0 || value as u64 > JS_MAX_SAFE_INTEGER {
            anyhow::bail!("Runtime Usage token field is outside the safe integer range");
        }
    }
    if let Some(cost) = &observation.cost {
        validate_decimal(&cost.amount)?;
        if cost.currency.len() != 3
            || !cost
                .currency
                .chars()
                .all(|character| character.is_ascii_uppercase())
        {
            anyhow::bail!("Runtime Usage cost currency must be a three-letter uppercase code");
        }
        if !matches!(
            cost.grain.as_str(),
            "model_call" | "turn" | "run" | "session" | "billing_bucket" | "unknown"
        ) {
            anyhow::bail!("Runtime Usage cost grain is unsupported");
        }
        if !matches!(
            cost.quality.as_str(),
            "runtime_reported"
                | "runtime_estimate"
                | "price_estimated"
                | "provider_reconciled"
                | "allocated"
                | "tokenizer_price_estimated"
        ) {
            anyhow::bail!("Runtime Usage cost quality is unsupported");
        }
    }
    Ok(())
}

fn validate_decimal(value: &str) -> Result<()> {
    if value.is_empty()
        || value.contains(['e', 'E', '+', '-'])
        || value.starts_with('.')
        || value.ends_with('.')
        || value.split('.').count() > 2
        || !value
            .chars()
            .all(|character| character.is_ascii_digit() || character == '.')
    {
        anyhow::bail!("Runtime Usage cost amount must be a non-negative canonical decimal");
    }
    Ok(())
}

fn digest_identity(salt: &str, value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(salt.as_bytes());
    hasher.update([0]);
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn source_observation_digest(
    salt: &str,
    run: &RuntimeUsageRun,
    key: &BufferedUsageKey,
    source_identity: &str,
) -> String {
    digest_identity(
        salt,
        &format!(
            "usage-source:{}:{}:{}:{}:{}:{}:{}",
            run.key.agent_run_id,
            run.key.execution_epoch,
            key.dialect_id,
            key.identity_suffix,
            key.source,
            key.scope,
            source_identity,
        ),
    )
}

fn collection_identity(database: &Database) -> Result<(String, String)> {
    database
        .connection()
        .query_row(
            r#"
            SELECT collection_epoch, collection_started_at
            FROM monitoring_collection_state
            WHERE singleton = 1
            "#,
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .context("Runtime Monitoring collection state is missing")
}

fn parse_time(value: &str) -> Result<DateTime<Utc>> {
    Ok(DateTime::parse_from_rfc3339(value)
        .with_context(|| format!("invalid RFC 3339 timestamp {value}"))?
        .with_timezone(&Utc))
}

fn hour_bucket(value: DateTime<Utc>) -> DateTime<Utc> {
    DateTime::from_timestamp(value.timestamp().div_euclid(3_600) * 3_600, 0)
        .expect("an existing UTC timestamp has a valid hour bucket")
}

fn rollup_status(status: &str) -> &str {
    match status {
        "succeeded" | "failed" | "cancelled" => status,
        _ => "active",
    }
}

fn support_snapshot_field(snapshot: &Value, field: &str) -> bool {
    snapshot
        .pointer(&format!("/nativeFields/{field}"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn support_snapshot(
    adapter_kind: AdapterKind,
    runtime_version: Option<&str>,
    compaction_observable: bool,
) -> Value {
    let (dialect_id, native_fields, tool_duration_coverage) = match adapter_kind {
        AdapterKind::CodexCli => (
            Some("codex-thread-token-usage-v1"),
            [
                true,
                true,
                true,
                true,
                codex_cache_write_supported(runtime_version),
                true,
                true,
                false,
            ],
            "fine_grained",
        ),
        AdapterKind::ClaudeCodeCli => (
            Some("claude-result-usage-v1"),
            [true, true, false, true, true, false, false, true],
            "fine_grained",
        ),
        AdapterKind::CopilotCli => (
            Some("acp-copilot-usage-v1"),
            [true, true, true, true, true, true, true, false],
            "fine_grained",
        ),
        AdapterKind::OpencodeCli
        | AdapterKind::KiroCli
        | AdapterKind::QoderCli
        | AdapterKind::CodebuddyCli
        | AdapterKind::QwenCode
        | AdapterKind::TraeCnCli => (
            Some("acp-usage-update-v1"),
            [false, false, false, false, false, true, true, true],
            "run_level",
        ),
        AdapterKind::AntigravityApp => (None, [false; 8], "unknown"),
    };
    json!({
        "dialectId": dialect_id,
        "parserVersion": dialect_id.map(|_| USAGE_PARSER_VERSION.to_string()),
        "nativeFields": {
            "input": native_fields[0],
            "output": native_fields[1],
            "reasoningOutput": native_fields[2],
            "cacheRead": native_fields[3],
            "cacheWrite": native_fields[4],
            "contextUsed": native_fields[5],
            "contextWindow": native_fields[6],
            "reportedCost": native_fields[7],
        },
        "toolDurationCoverage": tool_duration_coverage,
        "compactionObservable": compaction_observable,
    })
}

fn codex_cache_write_supported(runtime_version: Option<&str>) -> bool {
    // Upstream first shipped this field in the stable 0.145.0 schema. Keep the
    // adapter-level default when no parseable version was reported, but do not
    // claim the field for known older installations.
    runtime_version
        .and_then(parse_reported_version)
        .is_none_or(|version| version >= [0, 145, 0])
}

fn parse_reported_version(value: &str) -> Option<[u64; 3]> {
    value
        .split(|character: char| !character.is_ascii_digit() && character != '.')
        .filter(|part| !part.is_empty())
        .find_map(|part| {
            let mut components = part.split('.');
            Some([
                components.next()?.parse().ok()?,
                components.next()?.parse().ok()?,
                components.next()?.parse().ok()?,
            ])
        })
}

fn safe_integer(value: Option<&Value>) -> Option<i64> {
    value
        .and_then(Value::as_u64)
        .filter(|value| *value <= JS_MAX_SAFE_INTEGER)
        .map(|value| value as i64)
}

fn value_at_any<'a>(value: &'a Value, pointers: &[&str]) -> Option<&'a Value> {
    pointers.iter().find_map(|pointer| value.pointer(pointer))
}

fn integer_at_any(value: &Value, pointers: &[&str]) -> Option<i64> {
    safe_integer(value_at_any(value, pointers))
}

fn string_at_any(value: &Value, pointers: &[&str]) -> Option<String> {
    value_at_any(value, pointers)
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn cost_from_value(
    value: Option<&Value>,
    currency: &str,
    quality: &str,
    grain: &str,
) -> Option<RuntimeUsageCost> {
    if currency.len() != 3 || !currency.bytes().all(|byte| byte.is_ascii_uppercase()) {
        return None;
    }
    let amount = match value? {
        Value::String(value) => value.clone(),
        Value::Number(value) => value.to_string(),
        _ => return None,
    };
    let amount = add_decimal("0", &amount).ok()?;
    Some(RuntimeUsageCost {
        amount,
        currency: currency.to_string(),
        quality: quality.to_string(),
        grain: grain.to_string(),
    })
}

pub fn parse_codex_usage_message(method: &str, params: &Value) -> Vec<ParsedRuntimeUsage> {
    if method != "thread/tokenUsage/updated" {
        return Vec::new();
    }
    let token_usage = &params["tokenUsage"];
    let session_id = string_at_any(params, &["/threadId"]);
    let turn_id = string_at_any(params, &["/turnId"]);
    [
        ("last", RuntimeUsageCounterMode::Delta),
        ("total", RuntimeUsageCounterMode::Cumulative),
    ]
    .into_iter()
    .filter_map(|(key, counter_mode)| {
        let value = token_usage.get(key)?;
        let fields = RuntimeUsageFields {
            input_tokens: integer_at_any(value, &["/inputTokens"]),
            output_tokens: integer_at_any(value, &["/outputTokens"]),
            reasoning_output_tokens: integer_at_any(value, &["/reasoningOutputTokens"]),
            cache_read_input_tokens: integer_at_any(value, &["/cachedInputTokens"]),
            cache_write_input_tokens: integer_at_any(value, &["/cacheWriteInputTokens"]),
            context_used_tokens: (key == "total")
                .then(|| integer_at_any(value, &["/totalTokens"]))
                .flatten(),
            context_size_tokens: (key == "total")
                .then(|| integer_at_any(token_usage, &["/modelContextWindow"]))
                .flatten(),
        };
        (!fields.is_empty()).then_some(ParsedRuntimeUsage {
            identity_suffix: key.to_string(),
            dialect_id: "codex-thread-token-usage-v1".to_string(),
            source: "runtime_event".to_string(),
            scope: "turn".to_string(),
            counter_mode,
            input_semantics: RuntimeInputSemantics::CacheInclusiveTotal,
            native_session_id: session_id.clone(),
            native_turn_id: turn_id.clone(),
            fields,
            cost: None,
            occurred_at: None,
        })
    })
    .collect()
}

pub fn codex_usage_source_identity(params: &Value) -> Result<String> {
    let thread_id = params
        .get("threadId")
        .and_then(Value::as_str)
        .context("Codex Usage notification is missing threadId")?;
    let total = params
        .pointer("/tokenUsage/total")
        .context("Codex Usage notification is missing tokenUsage.total")?;
    // Codex can re-emit `last` when only rate-limit metadata changes. The
    // cumulative snapshot is the semantic Usage event boundary; envelope-only
    // changes must not turn the same `last` value into another delta.
    crate::command::canonical_json_digest(&json!({
        "dialectId": "codex-thread-token-usage-v1",
        "threadId": thread_id,
        "total": total,
    }))
}

pub fn parse_acp_usage_message(
    adapter_kind: AdapterKind,
    method: &str,
    params: &Value,
) -> Vec<ParsedRuntimeUsage> {
    if method == "session/update"
        && params
            .pointer("/update/sessionUpdate")
            .and_then(Value::as_str)
            == Some("usage_update")
    {
        let update = &params["update"];
        let fields = RuntimeUsageFields {
            context_used_tokens: integer_at_any(update, &["/used"]),
            context_size_tokens: integer_at_any(update, &["/size"]),
            ..RuntimeUsageFields::default()
        };
        let cost_currency = string_at_any(update, &["/cost/currency"]);
        let cost = cost_currency.as_deref().and_then(|currency| {
            cost_from_value(
                value_at_any(update, &["/cost/amount"]),
                currency,
                "runtime_reported",
                "session",
            )
        });
        if fields.is_empty() && cost.is_none() {
            return Vec::new();
        }
        return vec![ParsedRuntimeUsage {
            identity_suffix: "usage_update".to_string(),
            dialect_id: "acp-usage-update-v1".to_string(),
            source: "runtime_event".to_string(),
            scope: "session".to_string(),
            counter_mode: RuntimeUsageCounterMode::Gauge,
            input_semantics: RuntimeInputSemantics::Unknown,
            native_session_id: string_at_any(params, &["/sessionId"]),
            native_turn_id: None,
            fields,
            cost,
            occurred_at: None,
        }];
    }
    if method != "rovai/acp_prompt_completed" {
        return Vec::new();
    }
    if adapter_kind != AdapterKind::CopilotCli {
        return Vec::new();
    }
    let usage = params.pointer("/result/usage").unwrap_or(&Value::Null);
    let fields = RuntimeUsageFields {
        input_tokens: integer_at_any(usage, &["/inputTokens", "/input_tokens"]),
        output_tokens: integer_at_any(usage, &["/outputTokens", "/output_tokens"]),
        reasoning_output_tokens: integer_at_any(
            usage,
            &[
                "/thoughtTokens",
                "/reasoningOutputTokens",
                "/reasoning_output_tokens",
            ],
        ),
        cache_read_input_tokens: integer_at_any(
            usage,
            &[
                "/cachedReadTokens",
                "/cacheReadInputTokens",
                "/cache_read_input_tokens",
            ],
        ),
        cache_write_input_tokens: integer_at_any(
            usage,
            &[
                "/cachedWriteTokens",
                "/cacheWriteInputTokens",
                "/cache_write_input_tokens",
            ],
        ),
        context_used_tokens: integer_at_any(
            usage,
            &["/used", "/contextUsedTokens", "/context_used_tokens"],
        ),
        context_size_tokens: integer_at_any(
            usage,
            &["/size", "/contextWindowTokens", "/context_window_tokens"],
        ),
    };
    let cost_currency = string_at_any(usage, &["/cost/currency"]);
    let cost = cost_currency.as_deref().and_then(|currency| {
        cost_from_value(
            value_at_any(usage, &["/cost/amount"]),
            currency,
            "runtime_reported",
            "turn",
        )
    });
    if fields.is_empty() && cost.is_none() {
        return Vec::new();
    }
    vec![ParsedRuntimeUsage {
        identity_suffix: "terminal_usage".to_string(),
        dialect_id: "acp-copilot-usage-v1".to_string(),
        source: "runtime_result".to_string(),
        scope: "turn".to_string(),
        counter_mode: RuntimeUsageCounterMode::Delta,
        input_semantics: RuntimeInputSemantics::CacheInclusiveTotal,
        native_session_id: string_at_any(params, &["/sessionId"]),
        native_turn_id: string_at_any(params, &["/turnId"]),
        fields,
        cost,
        occurred_at: None,
    }]
}

pub fn parse_claude_result_usage(result: &Value) -> Vec<ParsedRuntimeUsage> {
    let usage = result.get("usage").unwrap_or(&Value::Null);
    let fields = RuntimeUsageFields {
        input_tokens: integer_at_any(usage, &["/input_tokens"]),
        output_tokens: integer_at_any(usage, &["/output_tokens"]),
        reasoning_output_tokens: integer_at_any(
            usage,
            &["/reasoning_output_tokens", "/thinking_tokens"],
        ),
        cache_read_input_tokens: integer_at_any(usage, &["/cache_read_input_tokens"]),
        cache_write_input_tokens: integer_at_any(
            usage,
            &["/cache_creation_input_tokens", "/cache_write_input_tokens"],
        ),
        context_used_tokens: integer_at_any(usage, &["/context_used_tokens"]),
        context_size_tokens: integer_at_any(usage, &["/context_window"]),
    };
    let cost = cost_from_value(
        value_at_any(result, &["/total_cost_usd", "/cost_usd"]),
        "USD",
        "runtime_estimate",
        "run",
    );
    if fields.is_empty() && cost.is_none() {
        return Vec::new();
    }
    vec![ParsedRuntimeUsage {
        identity_suffix: "terminal_result".to_string(),
        dialect_id: "claude-result-usage-v1".to_string(),
        source: "runtime_result".to_string(),
        scope: "run".to_string(),
        counter_mode: RuntimeUsageCounterMode::Delta,
        input_semantics: RuntimeInputSemantics::ExclusiveBuckets,
        native_session_id: string_at_any(result, &["/session_id"]),
        native_turn_id: string_at_any(result, &["/turn_id"]),
        fields,
        cost,
        occurred_at: None,
    }]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        agent_profile::configure_test_runtime,
        collaboration::{
            AddCampMemberCommand, CollaborationService, CreateCampCommand, ExecutionRequest,
            TestCampMessageAddress, TestCampMessageCommand,
        },
        command::{ActorRef, CommandEnvelope},
        runtime::{AgentRunWorkspace, ClaimAgentRunCommand, ExecutionRuntimeService},
    };
    use std::path::PathBuf;

    fn fixture(name: &str) -> Value {
        let source = match name {
            "codex" => include_str!("../tests/fixtures/runtime-usage/codex.json"),
            "claude" => include_str!("../tests/fixtures/runtime-usage/claude.json"),
            "copilot" => include_str!("../tests/fixtures/runtime-usage/copilot.json"),
            "opencode" => include_str!("../tests/fixtures/runtime-usage/opencode.json"),
            "kiro" => include_str!("../tests/fixtures/runtime-usage/kiro.json"),
            "qoder" => include_str!("../tests/fixtures/runtime-usage/qoder.json"),
            "codebuddy" => include_str!("../tests/fixtures/runtime-usage/codebuddy.json"),
            "qwen" => include_str!("../tests/fixtures/runtime-usage/qwen.json"),
            "trae" => include_str!("../tests/fixtures/runtime-usage/trae.json"),
            "antigravity" => {
                include_str!("../tests/fixtures/runtime-usage/antigravity.json")
            }
            _ => panic!("unknown Runtime Usage fixture"),
        };
        serde_json::from_str(source).unwrap()
    }

    fn user_envelope<P>(command_id: &str, camp_id: Option<&str>, payload: P) -> CommandEnvelope<P> {
        CommandEnvelope {
            command_id: command_id.to_string(),
            actor: ActorRef::User {
                user_id: "local_user".to_string(),
            },
            camp_id: camp_id.map(str::to_string),
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload,
        }
    }

    fn scheduler_envelope<P>(command_id: &str, camp_id: &str, payload: P) -> CommandEnvelope<P> {
        CommandEnvelope {
            command_id: command_id.to_string(),
            actor: ActorRef::System {
                component_id: "agent-run-scheduler".to_string(),
            },
            camp_id: Some(camp_id.to_string()),
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload,
        }
    }

    fn claimed_monitoring_run() -> (PathBuf, Database, AgentRunExecution) {
        let directory = std::env::temp_dir().join(format!(
            "rovai-runtime-monitoring-service-test-{}",
            Uuid::new_v4()
        ));
        let workspace = directory.join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let mut database = Database::open(&directory).unwrap();
        let collaboration = CollaborationService::default();
        let camp = collaboration
            .create_camp(
                &mut database,
                &user_envelope(
                    "monitoring-create-camp",
                    None,
                    CreateCampCommand::for_test_with_members(
                        workspace.to_string_lossy().to_string(),
                        &["agent_2"],
                        "agent_2",
                    ),
                ),
            )
            .unwrap();
        let camp_id = camp.result.payload["campId"].as_str().unwrap().to_string();
        collaboration
            .add_camp_member(
                &mut database,
                &user_envelope(
                    "monitoring-add-member",
                    Some(&camp_id),
                    AddCampMemberCommand {
                        camp_id: camp_id.clone(),
                        agent_id: "agent_2".to_string(),
                        capability_overrides: json!({}),
                    },
                ),
            )
            .unwrap();
        configure_test_runtime(&database, &["agent_2"]);
        let sent = collaboration
            .send_test_camp_message(
                &mut database,
                &user_envelope(
                    "monitoring-send",
                    Some(&camp_id),
                    TestCampMessageCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: None,
                        body: "验证运行监控采集".to_string(),
                        prepared_attachment_ids: Vec::new(),
                        address: TestCampMessageAddress::Default,
                        reply_to_camp_message_id: None,
                        execution: Some(ExecutionRequest {
                            task_id: None,
                            purpose: "验证运行监控采集".to_string(),
                            completion_role: "required".to_string(),
                            budget: None,
                        }),
                    },
                ),
            )
            .unwrap();
        let agent_run_id = sent.result.payload["agentRunIds"][0]
            .as_str()
            .unwrap()
            .to_string();
        let claim = ExecutionRuntimeService::default()
            .claim_agent_run(
                &mut database,
                &scheduler_envelope(
                    "monitoring-claim",
                    &camp_id,
                    ClaimAgentRunCommand {
                        agent_run_id: agent_run_id.clone(),
                        expected_version: 1,
                        lease_owner: "runtime-monitoring-test-host".to_string(),
                        lease_seconds: 60,
                        workspace: Some(AgentRunWorkspace {
                            execution_root: workspace.to_string_lossy().to_string(),
                            access: "write".to_string(),
                            isolation: "shared".to_string(),
                        }),
                        starting_git_observation: None,
                    },
                ),
            )
            .unwrap();
        let execution_epoch = claim.result.payload["executionEpoch"]
            .as_i64()
            .unwrap_or_else(|| {
                panic!("monitoring test claim was not accepted: {:?}", claim.result)
            });
        let execution = ExecutionRuntimeService::default()
            .load_agent_run_execution(&database, &agent_run_id, execution_epoch)
            .unwrap()
            .unwrap();
        (directory, database, execution)
    }

    fn claim_additional_monitoring_run(
        database: &mut Database,
        seed: &AgentRunExecution,
        suffix: &str,
    ) -> AgentRunExecution {
        let collaboration = CollaborationService::default();
        let sent = collaboration
            .send_test_camp_message(
                database,
                &user_envelope(
                    &format!("monitoring-send-{suffix}"),
                    Some(&seed.camp_id),
                    TestCampMessageCommand {
                        camp_id: seed.camp_id.clone(),
                        draft_revision: None,
                        body: format!("验证运行监控采集 {suffix}"),
                        prepared_attachment_ids: Vec::new(),
                        address: TestCampMessageAddress::Default,
                        reply_to_camp_message_id: None,
                        execution: Some(ExecutionRequest {
                            task_id: None,
                            purpose: format!("验证运行监控采集 {suffix}"),
                            completion_role: "required".to_string(),
                            budget: None,
                        }),
                    },
                ),
            )
            .unwrap();
        let agent_run_id = sent.result.payload["agentRunIds"][0]
            .as_str()
            .unwrap()
            .to_string();
        let claim = ExecutionRuntimeService::default()
            .claim_agent_run(
                database,
                &scheduler_envelope(
                    &format!("monitoring-claim-{suffix}"),
                    &seed.camp_id,
                    ClaimAgentRunCommand {
                        agent_run_id: agent_run_id.clone(),
                        expected_version: 1,
                        lease_owner: format!("runtime-monitoring-test-host-{suffix}"),
                        lease_seconds: 60,
                        workspace: Some(seed.workspace.clone()),
                        starting_git_observation: None,
                    },
                ),
            )
            .unwrap();
        let execution_epoch = claim.result.payload["executionEpoch"].as_i64().unwrap();
        ExecutionRuntimeService::default()
            .load_agent_run_execution(database, &agent_run_id, execution_epoch)
            .unwrap()
            .unwrap()
    }

    #[test]
    fn codex_fixture_separates_delta_from_cumulative_usage() {
        let event = fixture("codex");
        let parsed = parse_codex_usage_message(event["method"].as_str().unwrap(), &event["params"]);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].counter_mode, RuntimeUsageCounterMode::Delta);
        assert_eq!(parsed[1].counter_mode, RuntimeUsageCounterMode::Cumulative);
        assert_eq!(parsed[0].fields.input_tokens, Some(120));
        assert_eq!(parsed[0].fields.cache_read_input_tokens, Some(40));
        let normalized = normalize_usage(&parsed[0]);
        assert_eq!(normalized.fields.input_tokens, Some(70));
        assert_eq!(normalized.status, "complete");

        let old_support = support_snapshot(AdapterKind::CodexCli, Some("0.144.1"), false);
        assert_eq!(old_support["nativeFields"]["cacheWrite"], false);
        let first_supported =
            support_snapshot(AdapterKind::CodexCli, Some("codex-cli 0.145.0"), false);
        assert_eq!(first_supported["nativeFields"]["cacheWrite"], true);
        let current_support =
            support_snapshot(AdapterKind::CodexCli, Some("codex-cli 0.147.0"), false);
        assert_eq!(current_support["nativeFields"]["cacheWrite"], true);
        let unknown_support = support_snapshot(AdapterKind::CodexCli, None, false);
        assert_eq!(unknown_support["nativeFields"]["cacheWrite"], true);
    }

    #[test]
    fn codex_rate_limit_only_rebroadcast_does_not_repeat_last_delta() {
        let event = fixture("codex");
        let mut rebroadcast = event.clone();
        rebroadcast["params"]["rateLimits"] = json!({
            "primary": { "usedPercent": 42 }
        });
        assert_eq!(
            codex_usage_source_identity(&event["params"]).unwrap(),
            codex_usage_source_identity(&rebroadcast["params"]).unwrap(),
            "rate-limit-only changes must retain the cumulative Usage identity"
        );
        let mut advanced = event.clone();
        advanced["params"]["tokenUsage"]["total"]["inputTokens"] = json!(321);
        assert_ne!(
            codex_usage_source_identity(&event["params"]).unwrap(),
            codex_usage_source_identity(&advanced["params"]).unwrap(),
            "an advancing cumulative snapshot must receive a new Usage identity"
        );

        let (directory, mut database, execution) = claimed_monitoring_run();
        MonitoringService::enroll_run(&mut database, &execution, false).unwrap();
        let started = Instant::now();
        let mut buffer = RuntimeUsageBuffer::default();
        for notification in [&event, &rebroadcast] {
            buffer
                .observe(
                    &execution,
                    &codex_usage_source_identity(&notification["params"]).unwrap(),
                    &parse_codex_usage_message(
                        notification["method"].as_str().unwrap(),
                        &notification["params"],
                    ),
                    started,
                )
                .unwrap();
        }
        let terminal = buffer.drain(RuntimeUsageFlushTarget::All);
        assert_eq!(
            MonitoringService::record_usage_batches(&mut database, &terminal).unwrap(),
            2,
            "the semantic event should persist one last and one total observation"
        );
        let (raw_count, input, output, reasoning, cache_read, cache_write): (
            i64,
            i64,
            i64,
            i64,
            i64,
            i64,
        ) = database
            .connection()
            .query_row(
                r#"
                SELECT
                    (SELECT COUNT(*) FROM runtime_usage_raw_observation),
                    input_tokens, output_tokens, reasoning_output_tokens,
                    cache_read_input_tokens, cache_write_input_tokens
                FROM runtime_usage_run_rollup
                WHERE agent_run_id = ?1 AND execution_epoch = ?2
                "#,
                params![execution.agent_run_id, execution.execution_epoch],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(raw_count, 2);
        assert_eq!(
            (input, output, reasoning, cache_read, cache_write),
            (70, 30, 8, 40, 10)
        );

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn claude_fixture_preserves_sparse_token_buckets_and_decimal_cost() {
        let parsed = parse_claude_result_usage(&fixture("claude"));
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].fields.input_tokens, Some(70));
        assert_eq!(parsed[0].fields.cache_read_input_tokens, Some(25));
        assert_eq!(parsed[0].fields.cache_write_input_tokens, Some(15));
        assert_eq!(
            parsed[0].cost.as_ref().map(|cost| cost.amount.as_str()),
            Some("0.0042")
        );
        assert_eq!(
            parsed[0].cost.as_ref().map(|cost| cost.quality.as_str()),
            Some("runtime_estimate")
        );
        assert_eq!(normalize_usage(&parsed[0]).fields.input_tokens, Some(70));
    }

    #[test]
    fn copilot_fixture_normalizes_cache_inclusive_input_without_double_counting() {
        let event = fixture("copilot");
        let parsed = parse_acp_usage_message(
            AdapterKind::CopilotCli,
            event["method"].as_str().unwrap(),
            &event["params"],
        );
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].fields.reasoning_output_tokens, Some(6));
        let normalized = normalize_usage(&parsed[0]);
        assert_eq!(normalized.fields.input_tokens, Some(60));
        assert_eq!(normalized.status, "complete");
    }

    #[test]
    fn acp_standard_fixtures_only_claim_context_gauges() {
        let cases = [
            ("opencode", AdapterKind::OpencodeCli),
            ("kiro", AdapterKind::KiroCli),
            ("qoder", AdapterKind::QoderCli),
            ("codebuddy", AdapterKind::CodebuddyCli),
            ("qwen", AdapterKind::QwenCode),
            ("trae", AdapterKind::TraeCnCli),
        ];
        for (fixture_name, adapter_kind) in cases {
            let event = fixture(fixture_name);
            let parsed = parse_acp_usage_message(
                adapter_kind,
                event["method"].as_str().unwrap(),
                &event["params"],
            );
            assert_eq!(parsed.len(), 1, "{fixture_name}");
            assert_eq!(
                parsed[0].counter_mode,
                RuntimeUsageCounterMode::Gauge,
                "{fixture_name}"
            );
            assert!(
                parsed[0].fields.context_used_tokens.is_some(),
                "{fixture_name}"
            );
            assert!(
                parsed[0].fields.context_size_tokens.is_some(),
                "{fixture_name}"
            );
            assert_eq!(parsed[0].fields.input_tokens, None, "{fixture_name}");
            assert_eq!(parsed[0].fields.output_tokens, None, "{fixture_name}");
            assert_eq!(
                parsed[0].fields.cache_read_input_tokens, None,
                "{fixture_name}"
            );
            assert_eq!(
                parsed[0].fields.cache_write_input_tokens, None,
                "{fixture_name}"
            );
        }
    }

    #[test]
    fn acp_cost_requires_an_explicit_valid_currency() {
        let event = |cost: Value| {
            json!({
                "method": "session/update",
                "params": {
                    "sessionId": "acp-session",
                    "update": {
                        "sessionUpdate": "usage_update",
                        "used": 10,
                        "size": 100,
                        "cost": cost
                    }
                }
            })
        };
        for cost in [
            json!("1.25"),
            json!({ "amount": "1.25" }),
            json!({
                "amount": "1.25",
                "currency": "usd"
            }),
        ] {
            let message = event(cost);
            let parsed = parse_acp_usage_message(
                AdapterKind::OpencodeCli,
                message["method"].as_str().unwrap(),
                &message["params"],
            );
            assert_eq!(parsed.len(), 1);
            assert_eq!(parsed[0].cost, None, "missing currency must stay unknown");
        }
        let message = event(json!({ "amount": "1.25", "currency": "USD" }));
        let parsed = parse_acp_usage_message(
            AdapterKind::OpencodeCli,
            message["method"].as_str().unwrap(),
            &message["params"],
        );
        assert_eq!(
            parsed[0].cost.as_ref().map(|cost| cost.amount.as_str()),
            Some("1.25")
        );
        assert_eq!(
            parsed[0].cost.as_ref().map(|cost| cost.currency.as_str()),
            Some("USD")
        );
    }

    #[test]
    fn unverified_acp_terminal_token_fields_remain_unavailable() {
        let event = fixture("copilot");
        for adapter_kind in [
            AdapterKind::OpencodeCli,
            AdapterKind::KiroCli,
            AdapterKind::QoderCli,
            AdapterKind::CodebuddyCli,
            AdapterKind::QwenCode,
            AdapterKind::TraeCnCli,
        ] {
            assert!(
                parse_acp_usage_message(
                    adapter_kind,
                    event["method"].as_str().unwrap(),
                    &event["params"],
                )
                .is_empty(),
                "{} must not inherit Copilot's private Usage dialect",
                adapter_kind.as_str()
            );
        }
    }

    #[test]
    fn antigravity_fixture_does_not_manufacture_usage() {
        assert!(parse_claude_result_usage(&fixture("antigravity")).is_empty());
    }

    #[test]
    fn normalization_keeps_missing_cache_bucket_null_and_rejects_impossible_total() {
        let mut observation = ParsedRuntimeUsage {
            identity_suffix: "test".to_string(),
            dialect_id: "test".to_string(),
            source: "runtime_event".to_string(),
            scope: "turn".to_string(),
            counter_mode: RuntimeUsageCounterMode::Delta,
            input_semantics: RuntimeInputSemantics::CacheInclusiveTotal,
            native_session_id: None,
            native_turn_id: None,
            fields: RuntimeUsageFields {
                input_tokens: Some(10),
                cache_read_input_tokens: Some(8),
                ..RuntimeUsageFields::default()
            },
            cost: None,
            occurred_at: None,
        };
        let missing = normalize_usage(&observation);
        assert_eq!(missing.fields.input_tokens, None);
        assert_eq!(missing.status, "partial");
        assert_eq!(missing.diagnostic_code, Some("cache_bucket_missing"));

        observation.fields.cache_write_input_tokens = Some(5);
        let invalid = normalize_usage(&observation);
        assert_eq!(invalid.fields.input_tokens, None);
        assert_eq!(invalid.status, "invalid");
        assert_eq!(invalid.diagnostic_code, Some("cache_buckets_exceed_input"));
    }

    #[test]
    fn decimal_addition_is_exact_below_one_cent() {
        assert_eq!(add_decimal("0.0042", "0.0008").unwrap(), "0.005");
        assert_eq!(add_decimal("999.99", "0.02").unwrap(), "1000.01");
        assert_eq!(add_decimal("0", "0.0000").unwrap(), "0");

        let connection = Connection::open_in_memory().unwrap();
        register_monitoring_sql_functions(&connection).unwrap();
        let aggregate: String = connection
            .query_row(
                r#"
                SELECT rovai_decimal_sum(amount)
                FROM (
                    SELECT '0.0042' AS amount
                    UNION ALL SELECT '0.0008'
                    UNION ALL SELECT '999.99'
                    UNION ALL SELECT '0.02'
                )
                "#,
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(aggregate, "1000.015");
    }

    #[test]
    fn usage_buffer_dedupes_coalesces_and_obeys_due_and_terminal_flushes() {
        let (directory, mut database, execution) = claimed_monitoring_run();
        MonitoringService::enroll_run(&mut database, &execution, false).unwrap();
        let observation = parse_claude_result_usage(&fixture("claude"))
            .into_iter()
            .next()
            .unwrap();
        let started = Instant::now();
        let mut buffer = RuntimeUsageBuffer::default();
        buffer
            .observe(
                &execution,
                "source-1",
                std::slice::from_ref(&observation),
                started,
            )
            .unwrap();
        buffer
            .observe(
                &execution,
                "source-1",
                std::slice::from_ref(&observation),
                started,
            )
            .unwrap();
        buffer
            .observe(
                &execution,
                "source-2",
                std::slice::from_ref(&observation),
                started,
            )
            .unwrap();

        assert!(
            buffer
                .drain(RuntimeUsageFlushTarget::Due {
                    now: started + StdDuration::from_secs(3),
                    minimum_interval: StdDuration::from_secs(4),
                })
                .is_empty()
        );
        let batches = buffer.drain(RuntimeUsageFlushTarget::Due {
            now: started + StdDuration::from_secs(4),
            minimum_interval: StdDuration::from_secs(4),
        });
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].records.len(), 1);
        assert_eq!(
            batches[0].records[0].observation.fields.input_tokens,
            Some(140)
        );
        assert_eq!(
            batches[0].records[0]
                .observation
                .cost
                .as_ref()
                .map(|cost| cost.amount.as_str()),
            Some("0.0084")
        );

        buffer.restore(batches).unwrap();
        let terminal = buffer.drain(RuntimeUsageFlushTarget::Run {
            agent_run_id: execution.agent_run_id.clone(),
            execution_epoch: execution.execution_epoch,
        });
        assert_eq!(terminal.len(), 1);
        assert!(terminal[0].final_flush);
        assert_eq!(
            MonitoringService::record_usage_batches(&mut database, &terminal).unwrap(),
            1
        );
        buffer.complete(&terminal);
        assert!(buffer.drain(RuntimeUsageFlushTarget::All).is_empty());

        let mut restarted_buffer = RuntimeUsageBuffer::default();
        restarted_buffer
            .observe(
                &execution,
                "source-1",
                std::slice::from_ref(&observation),
                started,
            )
            .unwrap();
        restarted_buffer
            .observe(
                &execution,
                "source-3",
                std::slice::from_ref(&observation),
                started,
            )
            .unwrap();
        let restarted = restarted_buffer.drain(RuntimeUsageFlushTarget::All);
        assert_eq!(
            MonitoringService::record_usage_batches(&mut database, &restarted).unwrap(),
            1,
            "a persisted replay must be removed before a mixed coalesced flush is applied"
        );
        let (raw_count, source_count, input, cache_read, cache_write): (i64, i64, i64, i64, i64) =
            database
                .connection()
                .query_row(
                    r#"
                SELECT
                    (SELECT COUNT(*) FROM runtime_usage_raw_observation),
                    (SELECT COUNT(*) FROM runtime_usage_source_observation_dedupe),
                    input_tokens, cache_read_input_tokens,
                    cache_write_input_tokens
                FROM runtime_usage_run_rollup
                WHERE agent_run_id = ?1 AND execution_epoch = ?2
                "#,
                    params![execution.agent_run_id, execution.execution_epoch],
                    |row| {
                        Ok((
                            row.get(0)?,
                            row.get(1)?,
                            row.get(2)?,
                            row.get(3)?,
                            row.get(4)?,
                        ))
                    },
                )
                .unwrap();
        assert_eq!((raw_count, source_count), (2, 3));
        assert_eq!((input, cache_read, cache_write), (210, 75, 45));

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn usage_buffer_terminal_cleanup_removes_idle_state_after_periodic_flush() {
        let (directory, mut database, execution) = claimed_monitoring_run();
        MonitoringService::enroll_run(&mut database, &execution, false).unwrap();
        let observation = parse_claude_result_usage(&fixture("claude"))
            .into_iter()
            .next()
            .unwrap();
        let mut buffer = RuntimeUsageBuffer::default();
        buffer
            .observe(
                &execution,
                "source-before-terminal",
                &[observation],
                Instant::now(),
            )
            .unwrap();
        let periodic = buffer.drain(RuntimeUsageFlushTarget::Periodic);
        assert_eq!(
            MonitoringService::record_usage_batches(&mut database, &periodic).unwrap(),
            1
        );
        buffer.complete(&periodic);
        assert!(buffer.pending.is_empty());
        assert!(buffer.pending_since.is_empty());
        assert_eq!(buffer.runs.len(), 1);
        assert_eq!(buffer.seen_source_identities.len(), 1);

        buffer.finish_idle_target_after_flush(&RuntimeUsageFlushTarget::Run {
            agent_run_id: execution.agent_run_id,
            execution_epoch: execution.execution_epoch,
        });
        assert!(buffer.runs.is_empty());
        assert!(buffer.pending.is_empty());
        assert!(buffer.pending_since.is_empty());
        assert!(buffer.seen_source_identities.is_empty());

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn usage_buffer_preserves_gauge_arrival_order_across_failed_flush_restore() {
        let (directory, mut database, execution) = claimed_monitoring_run();
        MonitoringService::enroll_run(&mut database, &execution, false).unwrap();
        let gauge = |used| ParsedRuntimeUsage {
            identity_suffix: "context".to_string(),
            dialect_id: "test-gauge-v1".to_string(),
            source: "runtime_event".to_string(),
            scope: "session".to_string(),
            counter_mode: RuntimeUsageCounterMode::Gauge,
            input_semantics: RuntimeInputSemantics::Unknown,
            native_session_id: Some("session-fixture".to_string()),
            native_turn_id: None,
            fields: RuntimeUsageFields {
                context_used_tokens: Some(used),
                context_size_tokens: Some(1_000),
                ..RuntimeUsageFields::default()
            },
            cost: None,
            occurred_at: None,
        };
        let started = Instant::now();
        let mut buffer = RuntimeUsageBuffer::default();
        buffer
            .observe(&execution, "source-z", &[gauge(100)], started)
            .unwrap();
        let failed_flush = buffer.drain(RuntimeUsageFlushTarget::Periodic);
        buffer
            .observe(&execution, "source-a", &[gauge(200)], started)
            .unwrap();
        buffer.restore(failed_flush).unwrap();

        let terminal = buffer.drain(RuntimeUsageFlushTarget::All);
        assert_eq!(
            terminal[0].records[0]
                .observation
                .fields
                .context_used_tokens,
            Some(200),
            "restoring an older failed flush must not replace a newer gauge"
        );
        MonitoringService::record_usage_batches(&mut database, &terminal).unwrap();
        let persisted: (i64, i64) = database
            .connection()
            .query_row(
                r#"
                SELECT context_used_tokens, context_size_tokens
                FROM runtime_usage_run_rollup
                WHERE agent_run_id = ?1 AND execution_epoch = ?2
                "#,
                params![execution.agent_run_id, execution.execution_epoch],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(persisted, (200, 1_000));

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn recovery_epochs_are_one_logical_run_and_session_cost_gauges_are_raw_only() {
        let (directory, mut database, execution) = claimed_monitoring_run();
        assert!(MonitoringService::enroll_run(&mut database, &execution, false).unwrap());
        let gauge = |amount: &str, occurred_at: String| ParsedRuntimeUsage {
            identity_suffix: "usage_update".to_string(),
            dialect_id: "acp-usage-update-v1".to_string(),
            source: "runtime_event".to_string(),
            scope: "session".to_string(),
            counter_mode: RuntimeUsageCounterMode::Gauge,
            input_semantics: RuntimeInputSemantics::Unknown,
            native_session_id: Some("shared-native-session".to_string()),
            native_turn_id: None,
            fields: RuntimeUsageFields {
                context_used_tokens: Some(if amount == "10" { 10 } else { 15 }),
                context_size_tokens: Some(100),
                ..RuntimeUsageFields::default()
            },
            cost: Some(RuntimeUsageCost {
                amount: amount.to_string(),
                currency: "USD".to_string(),
                quality: "runtime_reported".to_string(),
                grain: "session".to_string(),
            }),
            occurred_at: Some(occurred_at),
        };
        let first_at = Utc::now();
        MonitoringService::record_usage(
            &mut database,
            &execution,
            "session-gauge-10",
            &gauge("10", first_at.to_rfc3339()),
        )
        .unwrap();

        database
            .connection()
            .execute(
                "UPDATE agent_run SET execution_epoch = ?2, updated_at = ?3 WHERE id = ?1",
                params![
                    execution.agent_run_id,
                    execution.execution_epoch + 1,
                    Utc::now().to_rfc3339()
                ],
            )
            .unwrap();
        let mut recovered = execution.clone();
        recovered.execution_epoch += 1;
        assert!(MonitoringService::enroll_run(&mut database, &recovered, false).unwrap());
        MonitoringService::record_usage(
            &mut database,
            &recovered,
            "session-gauge-15",
            &gauge("15", (first_at + Duration::milliseconds(1)).to_rfc3339()),
        )
        .unwrap();

        let (raw_count, cost_rollup_count, active_rollup): (i64, i64, i64) = database
            .connection()
            .query_row(
                r#"
                SELECT
                    (SELECT COUNT(*) FROM runtime_usage_raw_observation
                     WHERE agent_run_id = ?1),
                    (SELECT COUNT(*) FROM runtime_cost_run_rollup
                     WHERE agent_run_id = ?1),
                    (SELECT COALESCE(SUM(run_count), 0)
                     FROM monitoring_run_rollup_hourly
                     WHERE terminal_status = 'active')
                "#,
                [&execution.agent_run_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            raw_count, 2,
            "both cumulative gauges remain auditable raw facts"
        );
        assert_eq!(
            cost_rollup_count, 0,
            "a Session gauge has no attributable Run delta"
        );
        assert_eq!(
            active_rollup, 1,
            "recovery must not create a second logical Run"
        );

        let filter = MonitoringFilter {
            range: "24h".to_string(),
            adapter_kind: None,
            agent_id: None,
            terminal_status: None,
        };
        let snapshot = MonitoringService::snapshot(&mut database, &filter).unwrap();
        assert_eq!(snapshot["summary"]["runs"]["value"], 1);
        assert_eq!(
            snapshot["summary"]["bestAvailableCost"]["value"],
            Value::Null
        );
        assert_eq!(snapshot["usage"]["contextUsageRate"]["observedCount"], 1);
        assert_eq!(snapshot["usage"]["contextUsageRate"]["value"], 0.15);

        let ended_at = Utc::now().to_rfc3339();
        database
            .connection()
            .execute(
                "UPDATE agent_run SET status = 'succeeded', ended_at = ?2, updated_at = ?2 WHERE id = ?1",
                params![execution.agent_run_id, ended_at],
            )
            .unwrap();
        let (active_rollup, succeeded_rollup): (i64, i64) = database
            .connection()
            .query_row(
                r#"
                SELECT
                    COALESCE(SUM(terminal_status = 'active' AND run_count), 0),
                    COALESCE(SUM(terminal_status = 'succeeded' AND run_count), 0)
                FROM monitoring_run_rollup_hourly
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!((active_rollup, succeeded_rollup), (0, 1));

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn best_available_cost_selects_quality_per_logical_run_before_aggregation() {
        let (directory, mut database, first) = claimed_monitoring_run();
        MonitoringService::enroll_run(&mut database, &first, false).unwrap();
        let cost_observation = |quality: &str, amount: &str| ParsedRuntimeUsage {
            identity_suffix: format!("cost-{quality}"),
            dialect_id: "test-cost-v1".to_string(),
            source: if quality == "provider_reconciled" {
                "provider_usage_api".to_string()
            } else {
                "runtime_result".to_string()
            },
            scope: "run".to_string(),
            counter_mode: RuntimeUsageCounterMode::Delta,
            input_semantics: RuntimeInputSemantics::Unknown,
            native_session_id: None,
            native_turn_id: None,
            fields: RuntimeUsageFields::default(),
            cost: Some(RuntimeUsageCost {
                amount: amount.to_string(),
                currency: "USD".to_string(),
                quality: quality.to_string(),
                grain: "run".to_string(),
            }),
            occurred_at: None,
        };
        MonitoringService::record_usage(
            &mut database,
            &first,
            "first-runtime-cost",
            &cost_observation("runtime_reported", "4"),
        )
        .unwrap();
        MonitoringService::record_usage(
            &mut database,
            &first,
            "first-provider-cost",
            &cost_observation("provider_reconciled", "5"),
        )
        .unwrap();
        let ended_at = Utc::now().to_rfc3339();
        database
            .connection()
            .execute(
                "UPDATE agent_run SET status = 'succeeded', ended_at = ?2, updated_at = ?2 WHERE id = ?1",
                params![first.agent_run_id, ended_at],
            )
            .unwrap();
        let second = claim_additional_monitoring_run(&mut database, &first, "second-cost-run");
        MonitoringService::enroll_run(&mut database, &second, false).unwrap();
        MonitoringService::record_usage(
            &mut database,
            &second,
            "second-runtime-cost",
            &cost_observation("runtime_reported", "2"),
        )
        .unwrap();

        let snapshot = MonitoringService::snapshot(
            &mut database,
            &MonitoringFilter {
                range: "24h".to_string(),
                adapter_kind: None,
                agent_id: None,
                terminal_status: None,
            },
        )
        .unwrap();
        let best = snapshot["summary"]["bestAvailableCost"]["value"]
            .as_array()
            .unwrap();
        assert_eq!(best.len(), 2, "mixed best quality must remain explicit");
        assert!(
            best.iter().any(|value| {
                value["quality"] == "provider_reconciled" && value["amount"] == "5"
            })
        );
        assert!(
            best.iter()
                .any(|value| { value["quality"] == "runtime_reported" && value["amount"] == "2" })
        );
        assert_eq!(snapshot["summary"]["bestAvailableCost"]["observedCount"], 2);

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn tool_wall_clock_union_merges_overlap_only_within_each_run() {
        let mut intervals = vec![
            ("run-a".to_string(), 0, 10),
            ("run-a".to_string(), 5, 20),
            ("run-a".to_string(), 30, 35),
            ("run-b".to_string(), 4, 12),
        ];
        assert_eq!(interval_union_millis(&mut intervals), 33);
    }

    #[test]
    fn monitoring_snapshot_aggregates_tool_intervals_inside_sql() {
        let (directory, mut database, execution) = claimed_monitoring_run();
        MonitoringService::enroll_run(&mut database, &execution, false).unwrap();
        let base = Utc::now();
        for (index, start, end) in [(1, 0, 10), (2, 5, 20), (3, 30, 35)] {
            database
                .connection()
                .execute(
                    r#"
                    INSERT INTO canonical_runtime_activity(
                        agent_run_id, execution_epoch, operation_id,
                        classifier_version, activity_domain, semantic_kind,
                        tool_name, presentation_hint, phase, outcome,
                        credibility, coverage_level, source_authority,
                        source_evidence_ids_json, first_evidence_sequence,
                        last_evidence_sequence, revision, created_at, updated_at,
                        started_at, terminal_at
                    ) VALUES (
                        ?1, ?2, ?3, ?4, 'tool', 'tool', 'fixture-tool', NULL,
                        'terminal', 'succeeded', 'verified', 'fine_grained',
                        'fixture', '[]', ?5, ?5, 1, ?6, ?6, ?7, ?8
                    )
                    "#,
                    params![
                        execution.agent_run_id,
                        execution.execution_epoch,
                        format!("tool-{index}"),
                        crate::canonical_activity::CLASSIFIER_VERSION,
                        index,
                        base.to_rfc3339(),
                        (base + Duration::milliseconds(start)).to_rfc3339(),
                        (base + Duration::milliseconds(end)).to_rfc3339(),
                    ],
                )
                .unwrap();
        }
        let snapshot = MonitoringService::snapshot(
            &mut database,
            &MonitoringFilter {
                range: "24h".to_string(),
                adapter_kind: None,
                agent_id: None,
                terminal_status: None,
            },
        )
        .unwrap();
        let tool = &snapshot["reliability"]["toolDuration"];
        assert_eq!(tool["eligibleCalls"], 3);
        assert_eq!(tool["pairedCalls"], 3);
        assert_eq!(tool["pairedElapsedMillis"], 30);
        assert_eq!(tool["wallClockUnionMillis"], 25);

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn enrolled_run_persists_sparse_usage_dedupe_and_session_outcome() {
        let (directory, mut database, execution) = claimed_monitoring_run();
        assert!(MonitoringService::enroll_run(&mut database, &execution, false).unwrap());
        assert!(
            MonitoringService::record_session_decision(
                &mut database,
                &execution,
                NativeSessionResumeDisposition::Compatible,
            )
            .unwrap()
        );
        assert!(
            MonitoringService::record_session_outcome(
                &mut database,
                &execution,
                NativeSessionOutcome::Failed,
                false,
                Some("runtime_resume_failed"),
                None,
            )
            .unwrap()
        );
        assert!(
            MonitoringService::record_session_fallback(
                &mut database,
                &execution,
                "replacement-session"
            )
            .unwrap()
        );

        let observation = parse_claude_result_usage(&fixture("claude"))
            .into_iter()
            .next()
            .unwrap();
        assert!(
            MonitoringService::record_usage(
                &mut database,
                &execution,
                "terminal-result-1",
                &observation,
            )
            .unwrap()
        );
        assert!(
            !MonitoringService::record_usage(
                &mut database,
                &execution,
                "terminal-result-1",
                &observation,
            )
            .unwrap(),
            "a replayed source identity must be idempotent"
        );
        let now = Utc::now().to_rfc3339();
        database
            .connection()
            .execute(
                "UPDATE agent_run SET status = 'succeeded', ended_at = ?2, updated_at = ?2 WHERE id = ?1",
                params![execution.agent_run_id, now],
            )
            .unwrap();

        let (raw_usage_count, normalized_usage_count, evidence_count): (i64, i64, i64) = database
            .connection()
            .query_row(
                r#"
                SELECT
                    (SELECT COUNT(*) FROM runtime_usage_raw_observation
                     WHERE agent_run_id = ?1 AND execution_epoch = ?2),
                    (SELECT COUNT(*) FROM runtime_usage_normalized_observation normalized
                     JOIN runtime_usage_raw_observation raw
                       ON raw.id = normalized.raw_observation_id
                     WHERE raw.agent_run_id = ?1 AND raw.execution_epoch = ?2),
                    (SELECT evidence_count FROM monitoring_run_enrollment
                     WHERE agent_run_id = ?1 AND execution_epoch = ?2)
                "#,
                params![execution.agent_run_id, execution.execution_epoch],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!((raw_usage_count, normalized_usage_count), (1, 1));
        assert_eq!(
            evidence_count, 0,
            "Usage observations must not be appended as Execution Evidence"
        );
        let (active_rollup, succeeded_rollup): (i64, i64) = database
            .connection()
            .query_row(
                r#"
                SELECT
                    COALESCE(SUM(CASE WHEN terminal_status = 'active'
                                      THEN run_count ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN terminal_status = 'succeeded'
                                      THEN run_count ELSE 0 END), 0)
                FROM monitoring_run_rollup_hourly
                WHERE collection_epoch = (
                    SELECT collection_epoch FROM monitoring_collection_state
                    WHERE singleton = 1
                )
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!((active_rollup, succeeded_rollup), (0, 1));

        let filter = MonitoringFilter {
            range: "24h".to_string(),
            adapter_kind: None,
            agent_id: None,
            terminal_status: None,
        };
        let snapshot = MonitoringService::snapshot(&mut database, &filter).unwrap();
        let usage = &snapshot["usage"];
        assert_eq!(usage["inputTokens"]["value"], 110);
        assert_eq!(usage["outputTokens"]["value"], 20);
        assert_eq!(usage["costLayers"][0]["quality"], "runtime_estimate");
        assert_eq!(usage["costLayers"][0]["values"][0]["amount"], "0.0042");
        let reliability = &snapshot["reliability"];
        assert_eq!(reliability["session"]["resumeRequested"], 1);
        assert_eq!(reliability["session"]["failed"], 1);
        assert_eq!(reliability["session"]["fallbackToNewSession"], 1);
        assert_eq!(reliability["session"]["continuationRate"]["value"], 0.0);
        let native_session_digest: String = database
            .connection()
            .query_row(
                "SELECT native_session_digest FROM agent_run_native_session_fact WHERE agent_run_id = ?1",
                [&execution.agent_run_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_ne!(native_session_digest, "replacement-session");
        assert_eq!(native_session_digest.len(), 64);

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn clean_collection_queries_return_explicit_empty_views() {
        let directory = std::env::temp_dir().join(format!(
            "rovai-monitoring-empty-query-test-{}",
            Uuid::new_v4()
        ));
        let mut database = Database::open(&directory).unwrap();
        let filter = MonitoringFilter {
            range: "24h".to_string(),
            adapter_kind: None,
            agent_id: None,
            terminal_status: None,
        };
        let snapshot = MonitoringService::snapshot(&mut database, &filter).unwrap();
        let summary = &snapshot["summary"];
        let usage = &snapshot["usage"];
        let reliability = &snapshot["reliability"];

        assert_eq!(snapshot["schemaVersion"], 1);
        for view in [summary, usage, reliability] {
            assert_eq!(view["schemaVersion"], 1);
            assert_eq!(view["collection"]["schemaVersion"], 1);
            assert!(
                view["collection"]["collectionEpoch"]
                    .as_str()
                    .and_then(|value| Uuid::parse_str(value).ok())
                    .is_some()
            );
        }
        assert_eq!(summary["runs"]["availability"], "unavailable");
        assert_eq!(summary["runs"]["value"], Value::Null);
        assert_eq!(usage["inputTokens"]["value"], Value::Null);
        assert_eq!(reliability["endToEndP95Millis"]["value"], Value::Null);
    }
}
