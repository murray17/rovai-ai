use std::{
    collections::{BTreeMap, BTreeSet},
    time::Instant,
};

use anyhow::{Context, Result};
use chrono::{DateTime, Duration, Timelike, Utc};
use rusqlite::{
    Connection, OptionalExtension,
    functions::{Aggregate, Context as SqlFunctionContext, FunctionFlags},
    params, params_from_iter,
    types::Value as SqlValue,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{agent_profile::AdapterKind, db::Database, runtime::AgentRunExecution};

const USAGE_SCHEMA_VERSION: i64 = 2;
const USAGE_PARSER_VERSION: i64 = 2;
const JS_MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const CHECKPOINT_TTL_HOURS: i64 = 72;
const RETENTION_DAYS: i64 = 45;
const MODEL_TOP_N: usize = 10;

const ELIGIBLE_PROMPT_INPUT_TOTAL: i64 = 0x001;
const ELIGIBLE_UNCACHED_INPUT: i64 = 0x002;
const ELIGIBLE_CACHE_READ: i64 = 0x004;
const ELIGIBLE_CACHE_WRITE: i64 = 0x008;
const ELIGIBLE_OUTPUT: i64 = 0x010;
const ELIGIBLE_REASONING_OUTPUT: i64 = 0x020;
const ELIGIBLE_REQUEST_CACHE_HIT: i64 = 0x040;
const ELIGIBLE_RUNTIME_REPORTED_COST: i64 = 0x080;

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
        .context("failed to register Runtime Usage decimal aggregate")?;
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

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct UsageCounters {
    prompt_input_total_tokens: Option<i64>,
    uncached_input_tokens: Option<i64>,
    cache_read_tokens: Option<i64>,
    cache_write_tokens: Option<i64>,
    output_tokens: Option<i64>,
    reasoning_output_tokens: Option<i64>,
    cache_observable_request_count: Option<i64>,
    cache_hit_request_count: Option<i64>,
}

impl UsageCounters {
    fn any_observed(&self) -> bool {
        [
            self.prompt_input_total_tokens,
            self.uncached_input_tokens,
            self.cache_read_tokens,
            self.cache_write_tokens,
            self.output_tokens,
            self.reasoning_output_tokens,
            self.cache_observable_request_count,
            self.cache_hit_request_count,
        ]
        .into_iter()
        .any(|value| value.is_some())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct UsageRunKey {
    agent_run_id: String,
    execution_epoch: i64,
}

#[derive(Debug, Clone)]
pub struct RuntimeUsageRun {
    key: UsageRunKey,
    runtime_kind: AdapterKind,
    runtime_version: Option<String>,
    provider_key: Option<String>,
    model_key: Option<String>,
    service_tier: Option<String>,
}

impl RuntimeUsageRun {
    fn from_execution(execution: &AgentRunExecution) -> Self {
        Self {
            key: UsageRunKey {
                agent_run_id: execution.agent_run_id.clone(),
                execution_epoch: execution.execution_epoch,
            },
            runtime_kind: execution.runtime.adapter_kind,
            runtime_version: execution.runtime.reported_version.clone(),
            provider_key: string_option(
                &execution.runtime.model.options,
                &["providerKey", "provider"],
            ),
            model_key: non_empty(execution.runtime.model.model_id.clone()),
            service_tier: string_option(
                &execution.runtime.model.options,
                &["serviceTier", "service_tier"],
            ),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct BufferedUsageKey {
    run: UsageRunKey,
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
    fn new(run: &UsageRunKey, usage: &ParsedRuntimeUsage) -> Self {
        Self {
            run: run.clone(),
            identity_suffix: usage.identity_suffix.clone(),
            dialect_id: usage.dialect_id.clone(),
            source: usage.source.clone(),
            scope: usage.scope.clone(),
            counter_mode: usage.counter_mode,
            input_semantics: usage.input_semantics,
            native_session_id: usage.native_session_id.clone(),
            native_turn_id: usage.native_turn_id.clone(),
            cost_currency: usage.cost.as_ref().map(|cost| cost.currency.clone()),
            cost_quality: usage.cost.as_ref().map(|cost| cost.quality.clone()),
            cost_grain: usage.cost.as_ref().map(|cost| cost.grain.clone()),
        }
    }
}

#[derive(Debug, Clone)]
struct BufferedUsageRecord {
    key: BufferedUsageKey,
    usage: ParsedRuntimeUsage,
    source_identities: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct RuntimeUsageFlushBatch {
    run: RuntimeUsageRun,
    records: Vec<BufferedUsageRecord>,
    pending_since: Instant,
}

#[derive(Debug, Clone)]
pub enum RuntimeUsageFlushTarget {
    Periodic,
    Run {
        agent_run_id: String,
        execution_epoch: i64,
    },
    All,
}

#[derive(Debug, Default)]
pub struct RuntimeUsageBuffer {
    runs: BTreeMap<UsageRunKey, RuntimeUsageRun>,
    pending: BTreeMap<BufferedUsageKey, BufferedUsageRecord>,
    pending_since: BTreeMap<UsageRunKey, Instant>,
    seen_source_identities: BTreeSet<(BufferedUsageKey, String)>,
}

impl RuntimeUsageBuffer {
    pub fn register_run(&mut self, run: RuntimeUsageRun) {
        self.runs.insert(run.key.clone(), run);
    }

    pub fn observe_registered_run(
        &mut self,
        agent_run_id: &str,
        execution_epoch: i64,
        source_identity: &str,
        observations: &[ParsedRuntimeUsage],
        now: Instant,
    ) -> Result<bool> {
        let key = UsageRunKey {
            agent_run_id: agent_run_id.to_string(),
            execution_epoch,
        };
        let Some(run) = self.runs.get(&key).cloned() else {
            return Ok(false);
        };
        self.observe_run(&run, source_identity, observations, now)?;
        Ok(true)
    }

    pub fn observe_run(
        &mut self,
        run: &RuntimeUsageRun,
        source_identity: &str,
        observations: &[ParsedRuntimeUsage],
        now: Instant,
    ) -> Result<()> {
        self.runs.insert(run.key.clone(), run.clone());
        for usage in observations {
            validate_usage(usage)?;
            normalize_usage(usage)?;
            let key = BufferedUsageKey::new(&run.key, usage);
            if !self
                .seen_source_identities
                .insert((key.clone(), source_identity.to_string()))
            {
                continue;
            }
            self.pending_since.entry(run.key.clone()).or_insert(now);
            let incoming = BufferedUsageRecord {
                key: key.clone(),
                usage: usage.clone(),
                source_identities: vec![source_identity.to_string()],
            };
            merge_buffered_record(&mut self.pending, incoming)?;
        }
        Ok(())
    }

    pub fn drain(&mut self, target: RuntimeUsageFlushTarget) -> Vec<RuntimeUsageFlushBatch> {
        let selected: BTreeSet<_> = match &target {
            RuntimeUsageFlushTarget::Periodic => self.pending_since.keys().cloned().collect(),
            RuntimeUsageFlushTarget::Run {
                agent_run_id,
                execution_epoch,
            } => [UsageRunKey {
                agent_run_id: agent_run_id.clone(),
                execution_epoch: *execution_epoch,
            }]
            .into_iter()
            .collect(),
            RuntimeUsageFlushTarget::All => self.pending_since.keys().cloned().collect(),
        };
        let mut records = BTreeMap::<UsageRunKey, Vec<BufferedUsageRecord>>::new();
        let keys = self
            .pending
            .keys()
            .filter(|key| selected.contains(&key.run))
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
                Some(RuntimeUsageFlushBatch {
                    run: self.runs.get(&key)?.clone(),
                    records,
                    pending_since: self.pending_since.remove(&key)?,
                })
            })
            .collect()
    }

    pub fn restore(&mut self, batches: Vec<RuntimeUsageFlushBatch>) -> Result<()> {
        let newer = std::mem::take(&mut self.pending);
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
        for record in newer.into_values() {
            merge_buffered_record(&mut self.pending, record)?;
        }
        Ok(())
    }

    pub fn finish_idle_target_after_flush(&mut self, target: &RuntimeUsageFlushTarget) {
        let candidates: BTreeSet<UsageRunKey> = match target {
            RuntimeUsageFlushTarget::Run {
                agent_run_id,
                execution_epoch,
            } => [UsageRunKey {
                agent_run_id: agent_run_id.clone(),
                execution_epoch: *execution_epoch,
            }]
            .into_iter()
            .collect(),
            RuntimeUsageFlushTarget::All => self.runs.keys().cloned().collect(),
            RuntimeUsageFlushTarget::Periodic => BTreeSet::new(),
        };
        let idle = candidates
            .into_iter()
            .filter(|run| !self.pending_since.contains_key(run))
            .collect::<BTreeSet<_>>();
        self.runs.retain(|run, _| !idle.contains(run));
        self.seen_source_identities
            .retain(|(key, _)| !idle.contains(&key.run));
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
    for identity in incoming.source_identities {
        if !current.source_identities.contains(&identity) {
            current.source_identities.push(identity);
        }
    }
    if current.usage.counter_mode == RuntimeUsageCounterMode::Delta {
        merge_delta_fields(&mut current.usage.fields, &incoming.usage.fields)?;
        match (current.usage.cost.as_mut(), incoming.usage.cost.as_ref()) {
            (Some(current), Some(incoming)) => {
                current.amount = add_decimal(&current.amount, &incoming.amount)?;
            }
            (None, Some(incoming)) => current.usage.cost = Some(incoming.clone()),
            _ => {}
        }
    } else {
        current.usage.fields = incoming.usage.fields;
        current.usage.cost = incoming.usage.cost;
    }
    current.usage.occurred_at = incoming
        .usage
        .occurred_at
        .or_else(|| current.usage.occurred_at.clone());
    Ok(())
}

fn merge_delta_fields(
    current: &mut RuntimeUsageFields,
    incoming: &RuntimeUsageFields,
) -> Result<()> {
    add_optional(&mut current.input_tokens, incoming.input_tokens)?;
    add_optional(&mut current.output_tokens, incoming.output_tokens)?;
    add_optional(
        &mut current.reasoning_output_tokens,
        incoming.reasoning_output_tokens,
    )?;
    add_optional(
        &mut current.cache_read_input_tokens,
        incoming.cache_read_input_tokens,
    )?;
    add_optional(
        &mut current.cache_write_input_tokens,
        incoming.cache_write_input_tokens,
    )?;
    current.context_used_tokens = incoming.context_used_tokens.or(current.context_used_tokens);
    current.context_size_tokens = incoming.context_size_tokens.or(current.context_size_tokens);
    Ok(())
}

fn add_optional(current: &mut Option<i64>, incoming: Option<i64>) -> Result<()> {
    let Some(incoming) = incoming else {
        return Ok(());
    };
    *current = Some(
        current
            .unwrap_or(0)
            .checked_add(incoming)
            .context("Runtime Usage counter overflow")?,
    );
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitoringFilter {
    pub range: String,
    #[serde(default)]
    pub runtime_kind: Option<AdapterKind>,
    #[serde(default)]
    pub provider_key: Option<String>,
    #[serde(default)]
    pub model_key: Option<String>,
    #[serde(default)]
    pub cost_kind: Option<String>,
}

impl MonitoringFilter {
    pub fn validate(&self) -> Result<()> {
        if !matches!(self.range.as_str(), "24h" | "7d" | "30d") {
            anyhow::bail!("Runtime Usage range must be one of 24h, 7d, or 30d");
        }
        for (name, value) in [
            ("providerKey", self.provider_key.as_deref()),
            ("modelKey", self.model_key.as_deref()),
            ("costKind", self.cost_kind.as_deref()),
        ] {
            if value.is_some_and(|value| value.trim().is_empty() || value.len() > 160) {
                anyhow::bail!("Runtime Usage {name} filter is invalid");
            }
        }
        Ok(())
    }

    fn duration(&self) -> Duration {
        match self.range.as_str() {
            "24h" => Duration::hours(24),
            "7d" => Duration::days(7),
            "30d" => Duration::days(30),
            _ => unreachable!("validated Runtime Usage range"),
        }
    }
}

pub struct MonitoringService;

impl MonitoringService {
    pub fn enroll_run(
        database: &mut Database,
        execution: &AgentRunExecution,
    ) -> Result<Option<RuntimeUsageRun>> {
        let (collection_epoch, collection_started_at) = collection_identity(database)?;
        let created_at: Option<String> = database
            .connection()
            .query_row(
                "SELECT created_at FROM agent_run WHERE id = ?1",
                [&execution.agent_run_id],
                |row| row.get(0),
            )
            .optional()?;
        let Some(created_at) = created_at else {
            return Ok(None);
        };
        if parse_time(&created_at)? < parse_time(&collection_started_at)? {
            return Ok(None);
        }
        let run = RuntimeUsageRun::from_execution(execution);
        let now = Utc::now().to_rfc3339();
        database.connection().execute(
            r#"
            INSERT OR IGNORE INTO runtime_usage_run_summary(
                collection_epoch, agent_run_id, runtime_kind, runtime_version,
                provider_key, model_key, service_tier, parser_version,
                eligible_mask, input_semantics, usage_source, usage_quality,
                prompt_input_total_tokens, uncached_input_tokens,
                cache_read_tokens, cache_write_tokens, output_tokens,
                reasoning_output_tokens, cache_observable_request_count,
                cache_hit_request_count, cost_amount_decimal, cost_currency,
                cost_kind, cost_source, pricing_catalog_version,
                enrolled_at, first_observed_at, last_observed_at, finalized_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'unknown', NULL, NULL,
                NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
                NULL, NULL, NULL, NULL, NULL, ?10, NULL, NULL, NULL
            )
            "#,
            params![
                collection_epoch,
                run.key.agent_run_id,
                run.runtime_kind.as_str(),
                run.runtime_version,
                run.provider_key,
                run.model_key,
                run.service_tier,
                USAGE_PARSER_VERSION,
                eligible_mask(run.runtime_kind, run.runtime_version.as_deref()),
                now,
            ],
        )?;
        Self::enrolled_usage_run(database, &execution.agent_run_id, execution.execution_epoch)
    }

    pub fn enrolled_usage_run(
        database: &Database,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Result<Option<RuntimeUsageRun>> {
        let row = database
            .connection()
            .query_row(
                r#"
                SELECT runtime_kind, runtime_version, provider_key, model_key, service_tier
                FROM runtime_usage_run_summary
                WHERE collection_epoch = (
                    SELECT collection_epoch
                    FROM runtime_usage_collection_state
                    WHERE singleton_id = 1
                ) AND agent_run_id = ?1
                "#,
                [agent_run_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, Option<String>>(4)?,
                    ))
                },
            )
            .optional()?;
        let Some((runtime_kind, runtime_version, provider_key, model_key, service_tier)) = row
        else {
            return Ok(None);
        };
        Ok(Some(RuntimeUsageRun {
            key: UsageRunKey {
                agent_run_id: agent_run_id.to_string(),
                execution_epoch,
            },
            runtime_kind: runtime_kind.parse()?,
            runtime_version,
            provider_key,
            model_key,
            service_tier,
        }))
    }

    pub fn record_usage(
        database: &mut Database,
        execution: &AgentRunExecution,
        source_identity: &str,
        usage: &ParsedRuntimeUsage,
    ) -> Result<bool> {
        let run = RuntimeUsageRun::from_execution(execution);
        let batch = RuntimeUsageFlushBatch {
            run: run.clone(),
            records: vec![BufferedUsageRecord {
                key: BufferedUsageKey::new(&run.key, usage),
                usage: usage.clone(),
                source_identities: vec![source_identity.to_string()],
            }],
            pending_since: Instant::now(),
        };
        Ok(Self::record_usage_batches(database, &[batch])? > 0)
    }

    pub fn record_usage_batches(
        database: &mut Database,
        batches: &[RuntimeUsageFlushBatch],
    ) -> Result<usize> {
        if batches.is_empty() {
            return Ok(0);
        }
        let (collection_epoch, _) = collection_identity(database)?;
        let transaction = database.connection_mut().transaction()?;
        let mut changed = 0;
        for batch in batches {
            for record in &batch.records {
                if persist_usage_record(&transaction, &collection_epoch, &batch.run, record)? {
                    changed += 1;
                }
            }
        }
        transaction.commit()?;
        Ok(changed)
    }

    pub fn finalize_usage_run(database: &mut Database, agent_run_id: &str) -> Result<bool> {
        let (collection_epoch, _) = collection_identity(database)?;
        let transaction = database.connection_mut().transaction()?;
        let changed = finalize_run_in_transaction(&transaction, &collection_epoch, agent_run_id)?;
        transaction.commit()?;
        Ok(changed)
    }

    pub fn purge_expired(database: &mut Database) -> Result<usize> {
        let now = Utc::now();
        let cutoff = (now - Duration::days(RETENTION_DAYS)).to_rfc3339();
        let now = now.to_rfc3339();
        let transaction = database.connection_mut().transaction()?;
        let mut deleted = 0;
        deleted += transaction.execute(
            r#"
            DELETE FROM runtime_usage_checkpoint
            WHERE rowid IN (
                SELECT rowid FROM runtime_usage_checkpoint
                WHERE expires_at < ?1
                  AND NOT EXISTS (
                    SELECT 1 FROM agent_run
                    WHERE agent_run.id = runtime_usage_checkpoint.agent_run_id
                      AND agent_run.status IN ('queued', 'running', 'waiting')
                  )
                ORDER BY expires_at LIMIT 1000
            )
            "#,
            [&now],
        )?;
        deleted += transaction.execute(
            r#"
            DELETE FROM runtime_usage_run_summary
            WHERE rowid IN (
                SELECT rowid FROM runtime_usage_run_summary
                WHERE finalized_at IS NOT NULL
                  AND COALESCE(last_observed_at, finalized_at, enrolled_at) < ?1
                ORDER BY COALESCE(last_observed_at, finalized_at, enrolled_at)
                LIMIT 1000
            )
            "#,
            [&cutoff],
        )?;
        deleted += transaction.execute(
            r#"
            DELETE FROM runtime_usage_hourly
            WHERE rowid IN (
                SELECT rowid FROM runtime_usage_hourly
                WHERE bucket_start_at < ?1
                ORDER BY bucket_start_at LIMIT 1000
            )
            "#,
            [&cutoff],
        )?;
        deleted += transaction.execute(
            r#"
            DELETE FROM runtime_cost_reconciliation_bucket
            WHERE rowid IN (
                SELECT rowid FROM runtime_cost_reconciliation_bucket
                WHERE bucket_end_at < ?1
                ORDER BY bucket_end_at LIMIT 1000
            )
            "#,
            [&cutoff],
        )?;
        transaction.commit()?;
        Ok(deleted)
    }

    pub fn snapshot(database: &mut Database, filter: &MonitoringFilter) -> Result<Value> {
        filter.validate()?;
        let (collection_epoch, collection_started_at) = collection_identity(database)?;
        let observed_at = Utc::now();
        let requested_from = observed_at - filter.duration();
        let collection_start = parse_time(&collection_started_at)?;
        let from = requested_from.max(collection_start);
        let to = observed_at;
        let scope = Scope::new(&collection_epoch, from, to, filter);
        let summary = load_summary(database.connection(), &scope)?;
        let coverage = load_coverage(database.connection(), &scope)?;
        let run_cost = load_run_cost(database.connection(), &scope)?;
        let reconciliation = if filter.runtime_kind.is_none()
            && filter.model_key.is_none()
            && filter.cost_kind.is_none()
        {
            load_reconciliation_cost(database.connection(), &scope)?
        } else {
            ReconciliationCost::default()
        };
        let cost = cost_summary(run_cost, reconciliation)?;
        let trend = load_trend(database.connection(), &scope)?;
        let by_runtime = load_breakdown(database.connection(), &scope, BreakdownKind::Runtime)?;
        let by_model = load_breakdown(database.connection(), &scope, BreakdownKind::Model)?;
        Ok(json!({
            "schemaVersion": USAGE_SCHEMA_VERSION,
            "collection": {
                "epoch": collection_epoch,
                "startedAt": collection_started_at,
            },
            "range": {
                "from": from.to_rfc3339(),
                "to": to.to_rfc3339(),
            },
            "summary": {
                "promptInputTotalTokens": summary.prompt_input_total_tokens,
                "uncachedInputTokens": summary.uncached_input_tokens,
                "cacheReadTokens": summary.cache_read_tokens,
                "cacheWriteTokens": summary.cache_write_tokens,
                "outputTokens": summary.output_tokens,
                "reasoningOutputTokens": summary.reasoning_output_tokens,
                "cacheReadShare": ratio(
                    summary.cache_read_tokens,
                    summary.prompt_input_total_tokens,
                ),
                "requestCacheHitRate": ratio(
                    summary.cache_hit_request_count,
                    summary.cache_observable_request_count,
                ),
                "cost": cost,
            },
            "trend": trend,
            "byRuntime": by_runtime,
            "byModel": by_model,
            "coverage": coverage,
        }))
    }
}

fn persist_usage_record(
    transaction: &rusqlite::Transaction<'_>,
    collection_epoch: &str,
    run: &RuntimeUsageRun,
    record: &BufferedUsageRecord,
) -> Result<bool> {
    validate_usage(&record.usage)?;
    let normalized = normalize_usage(&record.usage)?;
    let enrolled: bool = transaction.query_row(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM runtime_usage_run_summary
            WHERE collection_epoch = ?1 AND agent_run_id = ?2
        )
        "#,
        params![collection_epoch, run.key.agent_run_id],
        |row| row.get(0),
    )?;
    if !enrolled {
        return Ok(false);
    }
    let checkpoint_key = checkpoint_key(run, &record.usage)?;
    let event_digest = crate::command::canonical_json_digest(&json!({
        "identities": record.source_identities,
        "dialect": record.usage.dialect_id,
        "suffix": record.usage.identity_suffix,
    }))?;
    let existing = load_checkpoint(
        transaction,
        collection_epoch,
        &run.key.agent_run_id,
        run.key.execution_epoch,
        &checkpoint_key,
    )?;
    if existing
        .as_ref()
        .is_some_and(|checkpoint| checkpoint.last_event_digest == event_digest)
    {
        return Ok(false);
    }
    let (delta, cost_delta) = match record.usage.counter_mode {
        RuntimeUsageCounterMode::Delta => (normalized.clone(), record.usage.cost.clone()),
        RuntimeUsageCounterMode::Cumulative | RuntimeUsageCounterMode::Gauge => {
            let delta = existing
                .as_ref()
                .map(|checkpoint| subtract_counters(&normalized, &checkpoint.baseline))
                .unwrap_or_default();
            let cost_delta = match (record.usage.cost.as_ref(), existing.as_ref()) {
                (Some(current), Some(checkpoint))
                    if checkpoint.cost_currency.as_deref() == Some(current.currency.as_str()) =>
                {
                    match checkpoint.cost_baseline.as_deref() {
                        Some(baseline) => subtract_decimal_nonnegative(&current.amount, baseline)?
                            .filter(|amount| !decimal_is_zero(amount))
                            .map(|amount| RuntimeUsageCost {
                                amount,
                                ..current.clone()
                            }),
                        None => None,
                    }
                }
                _ => None,
            };
            (delta, cost_delta)
        }
    };
    let now = Utc::now().to_rfc3339();
    let occurred_at = record.usage.occurred_at.as_deref().unwrap_or(&now);
    parse_time(occurred_at)?;
    if delta.any_observed() || cost_delta.is_some() {
        update_run_summary(
            transaction,
            collection_epoch,
            run,
            &record.usage,
            &delta,
            cost_delta.as_ref(),
            occurred_at,
            &now,
        )?;
        update_hourly(
            transaction,
            collection_epoch,
            run,
            &delta,
            occurred_at,
            &now,
        )?;
    }
    upsert_checkpoint(
        transaction,
        collection_epoch,
        run,
        &record.usage,
        &checkpoint_key,
        &event_digest,
        &normalized,
        &now,
    )?;
    Ok(true)
}

#[derive(Debug, Default)]
struct Checkpoint {
    last_event_digest: String,
    baseline: UsageCounters,
    cost_baseline: Option<String>,
    cost_currency: Option<String>,
}

fn load_checkpoint(
    transaction: &rusqlite::Transaction<'_>,
    collection_epoch: &str,
    agent_run_id: &str,
    execution_epoch: i64,
    checkpoint_key: &str,
) -> Result<Option<Checkpoint>> {
    transaction
        .query_row(
            r#"
            SELECT last_event_digest, prompt_input_total_baseline,
                   uncached_input_baseline, cache_read_baseline,
                   cache_write_baseline, output_baseline,
                   reasoning_output_baseline,
                   cache_observable_request_baseline,
                   cache_hit_request_baseline,
                   cumulative_cost_baseline_decimal,
                   cumulative_cost_currency
            FROM runtime_usage_checkpoint
            WHERE collection_epoch = ?1 AND agent_run_id = ?2
              AND execution_epoch = ?3 AND checkpoint_key = ?4
            "#,
            params![
                collection_epoch,
                agent_run_id,
                execution_epoch,
                checkpoint_key
            ],
            |row| {
                Ok(Checkpoint {
                    last_event_digest: row.get(0)?,
                    baseline: UsageCounters {
                        prompt_input_total_tokens: row.get(1)?,
                        uncached_input_tokens: row.get(2)?,
                        cache_read_tokens: row.get(3)?,
                        cache_write_tokens: row.get(4)?,
                        output_tokens: row.get(5)?,
                        reasoning_output_tokens: row.get(6)?,
                        cache_observable_request_count: row.get(7)?,
                        cache_hit_request_count: row.get(8)?,
                    },
                    cost_baseline: row.get(9)?,
                    cost_currency: row.get(10)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

#[allow(clippy::too_many_arguments)]
fn upsert_checkpoint(
    transaction: &rusqlite::Transaction<'_>,
    collection_epoch: &str,
    run: &RuntimeUsageRun,
    usage: &ParsedRuntimeUsage,
    checkpoint_key: &str,
    event_digest: &str,
    baseline: &UsageCounters,
    now: &str,
) -> Result<()> {
    let expires_at = (parse_time(now)? + Duration::hours(CHECKPOINT_TTL_HOURS)).to_rfc3339();
    transaction.execute(
        r#"
        INSERT INTO runtime_usage_checkpoint(
            collection_epoch, agent_run_id, execution_epoch, checkpoint_key,
            runtime_kind, parser_version, source_kind, counter_mode,
            last_event_digest, prompt_input_total_baseline,
            uncached_input_baseline, cache_read_baseline, cache_write_baseline,
            output_baseline, reasoning_output_baseline,
            cache_observable_request_baseline, cache_hit_request_baseline,
            cumulative_cost_baseline_decimal, cumulative_cost_currency,
            updated_at, expires_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
            ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21
        )
        ON CONFLICT(
            collection_epoch, agent_run_id, execution_epoch, checkpoint_key
        ) DO UPDATE SET
            last_event_digest = excluded.last_event_digest,
            prompt_input_total_baseline = excluded.prompt_input_total_baseline,
            uncached_input_baseline = excluded.uncached_input_baseline,
            cache_read_baseline = excluded.cache_read_baseline,
            cache_write_baseline = excluded.cache_write_baseline,
            output_baseline = excluded.output_baseline,
            reasoning_output_baseline = excluded.reasoning_output_baseline,
            cache_observable_request_baseline =
                excluded.cache_observable_request_baseline,
            cache_hit_request_baseline = excluded.cache_hit_request_baseline,
            cumulative_cost_baseline_decimal =
                excluded.cumulative_cost_baseline_decimal,
            cumulative_cost_currency = excluded.cumulative_cost_currency,
            updated_at = excluded.updated_at,
            expires_at = excluded.expires_at
        "#,
        params![
            collection_epoch,
            run.key.agent_run_id,
            run.key.execution_epoch,
            checkpoint_key,
            run.runtime_kind.as_str(),
            USAGE_PARSER_VERSION,
            format!("{}:{}:{}", usage.source, usage.scope, usage.dialect_id),
            usage.counter_mode.as_str(),
            event_digest,
            baseline.prompt_input_total_tokens,
            baseline.uncached_input_tokens,
            baseline.cache_read_tokens,
            baseline.cache_write_tokens,
            baseline.output_tokens,
            baseline.reasoning_output_tokens,
            baseline.cache_observable_request_count,
            baseline.cache_hit_request_count,
            usage.cost.as_ref().map(|cost| cost.amount.as_str()),
            usage.cost.as_ref().map(|cost| cost.currency.as_str()),
            now,
            expires_at,
        ],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn update_run_summary(
    transaction: &rusqlite::Transaction<'_>,
    collection_epoch: &str,
    run: &RuntimeUsageRun,
    usage: &ParsedRuntimeUsage,
    delta: &UsageCounters,
    cost_delta: Option<&RuntimeUsageCost>,
    occurred_at: &str,
    updated_at: &str,
) -> Result<()> {
    transaction.execute(
        r#"
        UPDATE runtime_usage_run_summary
        SET input_semantics = CASE
                WHEN input_semantics = 'unknown'
                     AND ?3 <> 'unknown' THEN ?3
                ELSE input_semantics
            END,
            usage_source = CASE
                WHEN usage_source IS NULL THEN ?4
                WHEN usage_source = ?4 THEN usage_source
                ELSE 'mixed'
            END,
            usage_quality = CASE
                WHEN usage_quality IS NULL THEN 'runtime_reported'
                WHEN usage_quality = 'runtime_reported' THEN usage_quality
                ELSE 'mixed'
            END,
            prompt_input_total_tokens = CASE WHEN ?5 IS NULL
                THEN prompt_input_total_tokens
                ELSE COALESCE(prompt_input_total_tokens, 0) + ?5 END,
            uncached_input_tokens = CASE WHEN ?6 IS NULL
                THEN uncached_input_tokens
                ELSE COALESCE(uncached_input_tokens, 0) + ?6 END,
            cache_read_tokens = CASE WHEN ?7 IS NULL
                THEN cache_read_tokens
                ELSE COALESCE(cache_read_tokens, 0) + ?7 END,
            cache_write_tokens = CASE WHEN ?8 IS NULL
                THEN cache_write_tokens
                ELSE COALESCE(cache_write_tokens, 0) + ?8 END,
            output_tokens = CASE WHEN ?9 IS NULL
                THEN output_tokens
                ELSE COALESCE(output_tokens, 0) + ?9 END,
            reasoning_output_tokens = CASE WHEN ?10 IS NULL
                THEN reasoning_output_tokens
                ELSE COALESCE(reasoning_output_tokens, 0) + ?10 END,
            cache_observable_request_count = CASE WHEN ?11 IS NULL
                THEN cache_observable_request_count
                ELSE COALESCE(cache_observable_request_count, 0) + ?11 END,
            cache_hit_request_count = CASE WHEN ?12 IS NULL
                THEN cache_hit_request_count
                ELSE COALESCE(cache_hit_request_count, 0) + ?12 END,
            first_observed_at = COALESCE(first_observed_at, ?13),
            last_observed_at = CASE
                WHEN last_observed_at IS NULL OR last_observed_at < ?13 THEN ?13
                ELSE last_observed_at
            END
        WHERE collection_epoch = ?1 AND agent_run_id = ?2
        "#,
        params![
            collection_epoch,
            run.key.agent_run_id,
            usage.input_semantics.as_str(),
            usage.source,
            delta.prompt_input_total_tokens,
            delta.uncached_input_tokens,
            delta.cache_read_tokens,
            delta.cache_write_tokens,
            delta.output_tokens,
            delta.reasoning_output_tokens,
            delta.cache_observable_request_count,
            delta.cache_hit_request_count,
            occurred_at,
        ],
    )?;
    if let Some(cost) = cost_delta {
        update_best_run_cost(
            transaction,
            collection_epoch,
            &run.key.agent_run_id,
            cost,
            updated_at,
        )?;
    }
    Ok(())
}

fn update_best_run_cost(
    transaction: &rusqlite::Transaction<'_>,
    collection_epoch: &str,
    agent_run_id: &str,
    incoming: &RuntimeUsageCost,
    updated_at: &str,
) -> Result<()> {
    let current = transaction.query_row(
        r#"
        SELECT cost_amount_decimal, cost_currency, cost_kind, cost_source
        FROM runtime_usage_run_summary
        WHERE collection_epoch = ?1 AND agent_run_id = ?2
        "#,
        params![collection_epoch, agent_run_id],
        |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        },
    )?;
    let should_replace = current.0.is_none()
        || cost_quality_rank(&incoming.quality)
            > cost_quality_rank(current.3.as_deref().unwrap_or(""));
    let amount = if !should_replace
        && current.1.as_deref() == Some(incoming.currency.as_str())
        && current.2.as_deref() == Some(incoming.grain.as_str())
        && current.3.as_deref() == Some(incoming.quality.as_str())
    {
        add_decimal(current.0.as_deref().unwrap_or("0"), &incoming.amount)?
    } else if should_replace {
        incoming.amount.clone()
    } else {
        return Ok(());
    };
    transaction.execute(
        r#"
        UPDATE runtime_usage_run_summary
        SET cost_amount_decimal = ?3, cost_currency = ?4,
            cost_kind = ?5, cost_source = ?6,
            last_observed_at = COALESCE(last_observed_at, ?7)
        WHERE collection_epoch = ?1 AND agent_run_id = ?2
        "#,
        params![
            collection_epoch,
            agent_run_id,
            amount,
            incoming.currency,
            incoming.grain,
            incoming.quality,
            updated_at,
        ],
    )?;
    Ok(())
}

fn update_hourly(
    transaction: &rusqlite::Transaction<'_>,
    collection_epoch: &str,
    run: &RuntimeUsageRun,
    delta: &UsageCounters,
    occurred_at: &str,
    updated_at: &str,
) -> Result<()> {
    if !delta.any_observed() {
        return Ok(());
    }
    let bucket = hour_bucket(parse_time(occurred_at)?).to_rfc3339();
    let changed = transaction.execute(
        r#"
        UPDATE runtime_usage_hourly
        SET prompt_input_total_tokens = CASE WHEN ?6 IS NULL
                THEN prompt_input_total_tokens
                ELSE COALESCE(prompt_input_total_tokens, 0) + ?6 END,
            uncached_input_tokens = CASE WHEN ?7 IS NULL
                THEN uncached_input_tokens
                ELSE COALESCE(uncached_input_tokens, 0) + ?7 END,
            cache_read_tokens = CASE WHEN ?8 IS NULL
                THEN cache_read_tokens
                ELSE COALESCE(cache_read_tokens, 0) + ?8 END,
            cache_write_tokens = CASE WHEN ?9 IS NULL
                THEN cache_write_tokens
                ELSE COALESCE(cache_write_tokens, 0) + ?9 END,
            output_tokens = CASE WHEN ?10 IS NULL
                THEN output_tokens
                ELSE COALESCE(output_tokens, 0) + ?10 END,
            reasoning_output_tokens = CASE WHEN ?11 IS NULL
                THEN reasoning_output_tokens
                ELSE COALESCE(reasoning_output_tokens, 0) + ?11 END,
            cache_observable_request_count = CASE WHEN ?12 IS NULL
                THEN cache_observable_request_count
                ELSE COALESCE(cache_observable_request_count, 0) + ?12 END,
            cache_hit_request_count = CASE WHEN ?13 IS NULL
                THEN cache_hit_request_count
                ELSE COALESCE(cache_hit_request_count, 0) + ?13 END,
            last_updated_at = ?14
        WHERE collection_epoch = ?1 AND bucket_start_at = ?2
          AND runtime_kind = ?3 AND provider_key IS ?4 AND model_key IS ?5
        "#,
        params![
            collection_epoch,
            bucket,
            run.runtime_kind.as_str(),
            run.provider_key,
            run.model_key,
            delta.prompt_input_total_tokens,
            delta.uncached_input_tokens,
            delta.cache_read_tokens,
            delta.cache_write_tokens,
            delta.output_tokens,
            delta.reasoning_output_tokens,
            delta.cache_observable_request_count,
            delta.cache_hit_request_count,
            updated_at,
        ],
    )?;
    if changed == 0 {
        transaction.execute(
            r#"
            INSERT INTO runtime_usage_hourly(
                collection_epoch, bucket_start_at, runtime_kind,
                provider_key, model_key, prompt_input_total_tokens,
                uncached_input_tokens, cache_read_tokens, cache_write_tokens,
                output_tokens, reasoning_output_tokens,
                cache_observable_request_count, cache_hit_request_count,
                last_updated_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
                ?10, ?11, ?12, ?13, ?14
            )
            "#,
            params![
                collection_epoch,
                bucket,
                run.runtime_kind.as_str(),
                run.provider_key,
                run.model_key,
                delta.prompt_input_total_tokens,
                delta.uncached_input_tokens,
                delta.cache_read_tokens,
                delta.cache_write_tokens,
                delta.output_tokens,
                delta.reasoning_output_tokens,
                delta.cache_observable_request_count,
                delta.cache_hit_request_count,
                updated_at,
            ],
        )?;
    }
    Ok(())
}

fn finalize_run_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    collection_epoch: &str,
    agent_run_id: &str,
) -> Result<bool> {
    transaction.execute(
        r#"
        DELETE FROM runtime_usage_checkpoint
        WHERE collection_epoch = ?1 AND agent_run_id = ?2
        "#,
        params![collection_epoch, agent_run_id],
    )?;
    let changed = transaction.execute(
        r#"
        UPDATE runtime_usage_run_summary
        SET finalized_at = COALESCE(finalized_at, ?3)
        WHERE collection_epoch = ?1 AND agent_run_id = ?2
        "#,
        params![collection_epoch, agent_run_id, Utc::now().to_rfc3339()],
    )?;
    Ok(changed > 0)
}

fn checkpoint_key(run: &RuntimeUsageRun, usage: &ParsedRuntimeUsage) -> Result<String> {
    crate::command::canonical_json_digest(&json!({
        "runtimeKind": run.runtime_kind,
        "dialect": usage.dialect_id,
        "suffix": usage.identity_suffix,
        "scope": usage.scope,
        "source": usage.source,
        "nativeSession": usage.native_session_id,
        "nativeTurn": usage.native_turn_id,
    }))
}

fn normalize_usage(usage: &ParsedRuntimeUsage) -> Result<UsageCounters> {
    validate_usage(usage)?;
    let read = usage.fields.cache_read_input_tokens;
    let write = usage.fields.cache_write_input_tokens;
    let input = usage.fields.input_tokens;
    let (prompt_total, uncached) = match usage.input_semantics {
        RuntimeInputSemantics::CacheInclusiveTotal => {
            if let (Some(total), Some(read), Some(write)) = (input, read, write) {
                let cached = read
                    .checked_add(write)
                    .context("Runtime Usage cache bucket overflow")?;
                if cached > total {
                    anyhow::bail!("Runtime Usage cache buckets exceed prompt input total");
                }
                (Some(total), Some(total - cached))
            } else {
                (input, None)
            }
        }
        RuntimeInputSemantics::ExclusiveBuckets => {
            let prompt_total = match (input, read, write) {
                (Some(uncached), Some(read), Some(write)) => Some(
                    uncached
                        .checked_add(read)
                        .and_then(|value| value.checked_add(write))
                        .context("Runtime Usage prompt input total overflow")?,
                ),
                _ => None,
            };
            (prompt_total, input)
        }
        RuntimeInputSemantics::Unknown => (None, None),
    };
    if let (Some(reasoning), Some(output)) = (
        usage.fields.reasoning_output_tokens,
        usage.fields.output_tokens,
    ) && reasoning > output
    {
        anyhow::bail!("Runtime Usage reasoning output exceeds output total");
    }
    let cache_observable = (read.is_some() || write.is_some()).then_some(1);
    let cache_hit = cache_observable.map(|_| i64::from(read.unwrap_or(0) > 0));
    Ok(UsageCounters {
        prompt_input_total_tokens: prompt_total,
        uncached_input_tokens: uncached,
        cache_read_tokens: read,
        cache_write_tokens: write,
        output_tokens: usage.fields.output_tokens,
        reasoning_output_tokens: usage.fields.reasoning_output_tokens,
        cache_observable_request_count: cache_observable,
        cache_hit_request_count: cache_hit,
    })
}

fn subtract_counters(current: &UsageCounters, baseline: &UsageCounters) -> UsageCounters {
    UsageCounters {
        prompt_input_total_tokens: counter_delta(
            current.prompt_input_total_tokens,
            baseline.prompt_input_total_tokens,
        ),
        uncached_input_tokens: counter_delta(
            current.uncached_input_tokens,
            baseline.uncached_input_tokens,
        ),
        cache_read_tokens: counter_delta(current.cache_read_tokens, baseline.cache_read_tokens),
        cache_write_tokens: counter_delta(current.cache_write_tokens, baseline.cache_write_tokens),
        output_tokens: counter_delta(current.output_tokens, baseline.output_tokens),
        reasoning_output_tokens: counter_delta(
            current.reasoning_output_tokens,
            baseline.reasoning_output_tokens,
        ),
        cache_observable_request_count: counter_delta(
            current.cache_observable_request_count,
            baseline.cache_observable_request_count,
        ),
        cache_hit_request_count: counter_delta(
            current.cache_hit_request_count,
            baseline.cache_hit_request_count,
        ),
    }
}

fn counter_delta(current: Option<i64>, baseline: Option<i64>) -> Option<i64> {
    match (current, baseline) {
        (Some(current), Some(baseline)) if current > baseline => Some(current - baseline),
        _ => None,
    }
}

fn validate_usage(usage: &ParsedRuntimeUsage) -> Result<()> {
    validate_key(&usage.identity_suffix, "source identity")?;
    validate_key(&usage.dialect_id, "dialect")?;
    if !matches!(
        usage.source.as_str(),
        "runtime_event"
            | "runtime_result"
            | "runtime_private_extension"
            | "provider_usage_api"
            | "local_tokenizer"
    ) {
        anyhow::bail!("Runtime Usage source is unsupported");
    }
    if !matches!(
        usage.scope.as_str(),
        "model_call" | "turn" | "run" | "session"
    ) {
        anyhow::bail!("Runtime Usage scope is unsupported");
    }
    for value in [
        usage.fields.input_tokens,
        usage.fields.output_tokens,
        usage.fields.reasoning_output_tokens,
        usage.fields.cache_read_input_tokens,
        usage.fields.cache_write_input_tokens,
        usage.fields.context_used_tokens,
        usage.fields.context_size_tokens,
    ]
    .into_iter()
    .flatten()
    {
        if value < 0 || value as u64 > JS_MAX_SAFE_INTEGER {
            anyhow::bail!("Runtime Usage token field is outside the safe integer range");
        }
    }
    if let Some(cost) = &usage.cost {
        validate_decimal(&cost.amount)?;
        validate_currency(&cost.currency)?;
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
                | "tokenizer_price_estimated"
        ) {
            anyhow::bail!("Runtime Usage cost quality is unsupported");
        }
    }
    Ok(())
}

fn eligible_mask(runtime: AdapterKind, runtime_version: Option<&str>) -> i64 {
    match runtime {
        AdapterKind::CodexCli => {
            let mut mask = ELIGIBLE_PROMPT_INPUT_TOTAL
                | ELIGIBLE_CACHE_READ
                | ELIGIBLE_OUTPUT
                | ELIGIBLE_REASONING_OUTPUT
                | ELIGIBLE_REQUEST_CACHE_HIT;
            if codex_cache_write_supported(runtime_version) {
                mask |= ELIGIBLE_CACHE_WRITE | ELIGIBLE_UNCACHED_INPUT;
            }
            mask
        }
        AdapterKind::ClaudeCodeCli => {
            ELIGIBLE_PROMPT_INPUT_TOTAL
                | ELIGIBLE_UNCACHED_INPUT
                | ELIGIBLE_CACHE_READ
                | ELIGIBLE_CACHE_WRITE
                | ELIGIBLE_OUTPUT
                | ELIGIBLE_REASONING_OUTPUT
                | ELIGIBLE_REQUEST_CACHE_HIT
                | ELIGIBLE_RUNTIME_REPORTED_COST
        }
        AdapterKind::CopilotCli => {
            ELIGIBLE_PROMPT_INPUT_TOTAL
                | ELIGIBLE_UNCACHED_INPUT
                | ELIGIBLE_CACHE_READ
                | ELIGIBLE_CACHE_WRITE
                | ELIGIBLE_OUTPUT
                | ELIGIBLE_REASONING_OUTPUT
                | ELIGIBLE_REQUEST_CACHE_HIT
                | ELIGIBLE_RUNTIME_REPORTED_COST
        }
        AdapterKind::OpencodeCli
        | AdapterKind::KiroCli
        | AdapterKind::QoderCli
        | AdapterKind::CodebuddyCli
        | AdapterKind::QwenCode
        | AdapterKind::TraeCnCli => ELIGIBLE_RUNTIME_REPORTED_COST,
        AdapterKind::AntigravityApp => 0,
    }
}

#[derive(Debug)]
struct Scope {
    where_sql: String,
    params: Vec<SqlValue>,
    collection_epoch: String,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    runtime_kind: Option<String>,
    provider_key: Option<String>,
    model_key: Option<String>,
    cost_kind: Option<String>,
    daily_trend: bool,
}

impl Scope {
    fn new(
        collection_epoch: &str,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
        filter: &MonitoringFilter,
    ) -> Self {
        let mut where_sql = String::from(
            "collection_epoch = ? AND enrolled_at < ? AND COALESCE(last_observed_at, enrolled_at) >= ?",
        );
        let mut params = vec![
            SqlValue::Text(collection_epoch.to_string()),
            SqlValue::Text(to.to_rfc3339()),
            SqlValue::Text(from.to_rfc3339()),
        ];
        if let Some(runtime) = filter.runtime_kind {
            where_sql.push_str(" AND runtime_kind = ?");
            params.push(SqlValue::Text(runtime.as_str().to_string()));
        }
        if let Some(provider) = &filter.provider_key {
            where_sql.push_str(" AND provider_key = ?");
            params.push(SqlValue::Text(provider.clone()));
        }
        if let Some(model) = &filter.model_key {
            where_sql.push_str(" AND model_key = ?");
            params.push(SqlValue::Text(model.clone()));
        }
        Self {
            where_sql,
            params,
            collection_epoch: collection_epoch.to_string(),
            from,
            to,
            runtime_kind: filter
                .runtime_kind
                .map(|runtime| runtime.as_str().to_string()),
            provider_key: filter.provider_key.clone(),
            model_key: filter.model_key.clone(),
            cost_kind: filter.cost_kind.clone(),
            daily_trend: filter.range != "24h",
        }
    }
}

#[derive(Debug, Default)]
struct SummaryAggregate {
    prompt_input_total_tokens: Option<i64>,
    uncached_input_tokens: Option<i64>,
    cache_read_tokens: Option<i64>,
    cache_write_tokens: Option<i64>,
    output_tokens: Option<i64>,
    reasoning_output_tokens: Option<i64>,
    cache_observable_request_count: Option<i64>,
    cache_hit_request_count: Option<i64>,
}

fn load_summary(connection: &Connection, scope: &Scope) -> Result<SummaryAggregate> {
    let sql = format!(
        r#"
        SELECT SUM(prompt_input_total_tokens), SUM(uncached_input_tokens),
               SUM(cache_read_tokens), SUM(cache_write_tokens),
               SUM(output_tokens), SUM(reasoning_output_tokens),
               SUM(cache_observable_request_count), SUM(cache_hit_request_count)
        FROM runtime_usage_run_summary WHERE {}
        "#,
        scope.where_sql
    );
    connection
        .query_row(&sql, params_from_iter(scope.params.clone()), |row| {
            Ok(SummaryAggregate {
                prompt_input_total_tokens: row.get(0)?,
                uncached_input_tokens: row.get(1)?,
                cache_read_tokens: row.get(2)?,
                cache_write_tokens: row.get(3)?,
                output_tokens: row.get(4)?,
                reasoning_output_tokens: row.get(5)?,
                cache_observable_request_count: row.get(6)?,
                cache_hit_request_count: row.get(7)?,
            })
        })
        .map_err(Into::into)
}

fn load_coverage(connection: &Connection, scope: &Scope) -> Result<Value> {
    let cost_observed = if scope.cost_kind.is_some() {
        "COALESCE(SUM(CASE WHEN cost_amount_decimal IS NOT NULL AND cost_kind = ? THEN 1 ELSE 0 END), 0)"
    } else {
        "COUNT(cost_amount_decimal)"
    };
    let sql = format!(
        r#"
        SELECT
            COALESCE(SUM((eligible_mask & {prompt}) <> 0), 0), COUNT(prompt_input_total_tokens),
            COALESCE(SUM((eligible_mask & {uncached}) <> 0), 0), COUNT(uncached_input_tokens),
            COALESCE(SUM((eligible_mask & {read}) <> 0), 0), COUNT(cache_read_tokens),
            COALESCE(SUM((eligible_mask & {write}) <> 0), 0), COUNT(cache_write_tokens),
            COALESCE(SUM((eligible_mask & {output}) <> 0), 0), COUNT(output_tokens),
            COALESCE(SUM((eligible_mask & {reasoning}) <> 0), 0), COUNT(reasoning_output_tokens),
            COALESCE(SUM((eligible_mask & {hit}) <> 0), 0),
                COUNT(cache_observable_request_count),
            COALESCE(SUM((eligible_mask & {cost}) <> 0), 0), {cost_observed}
        FROM runtime_usage_run_summary WHERE {}
        "#,
        scope.where_sql,
        prompt = ELIGIBLE_PROMPT_INPUT_TOTAL,
        uncached = ELIGIBLE_UNCACHED_INPUT,
        read = ELIGIBLE_CACHE_READ,
        write = ELIGIBLE_CACHE_WRITE,
        output = ELIGIBLE_OUTPUT,
        reasoning = ELIGIBLE_REASONING_OUTPUT,
        hit = ELIGIBLE_REQUEST_CACHE_HIT,
        cost = ELIGIBLE_RUNTIME_REPORTED_COST,
    );
    let mut query_params = scope.params.clone();
    if let Some(kind) = &scope.cost_kind {
        query_params.insert(0, SqlValue::Text(kind.clone()));
    }
    connection
        .query_row(&sql, params_from_iter(query_params), |row| {
            Ok(json!({
                "promptInputTotalTokens": coverage_value(row.get(0)?, row.get(1)?),
                "uncachedInputTokens": coverage_value(row.get(2)?, row.get(3)?),
                "cacheReadTokens": coverage_value(row.get(4)?, row.get(5)?),
                "cacheWriteTokens": coverage_value(row.get(6)?, row.get(7)?),
                "outputTokens": coverage_value(row.get(8)?, row.get(9)?),
                "reasoningOutputTokens": coverage_value(row.get(10)?, row.get(11)?),
                "requestCacheHitRate": coverage_value(row.get(12)?, row.get(13)?),
                "cost": coverage_value(row.get(14)?, row.get(15)?),
            }))
        })
        .map_err(Into::into)
}

fn coverage_value(eligible_runs: i64, observed_runs: i64) -> Value {
    json!({
        "eligibleRuns": eligible_runs,
        "observedRuns": observed_runs,
    })
}

#[derive(Debug, Clone)]
struct Money {
    amount: String,
    currency: String,
    kind: String,
    source: String,
}

fn load_run_cost(connection: &Connection, scope: &Scope) -> Result<Vec<Money>> {
    let mut sql = format!(
        r#"
        SELECT cost_currency, cost_kind, cost_source,
               rovai_decimal_sum(cost_amount_decimal)
        FROM runtime_usage_run_summary
        WHERE {} AND cost_amount_decimal IS NOT NULL
        "#,
        scope.where_sql
    );
    let mut query_params = scope.params.clone();
    if let Some(kind) = &scope.cost_kind {
        sql.push_str(" AND cost_kind = ?");
        query_params.push(SqlValue::Text(kind.clone()));
    }
    sql.push_str(" GROUP BY cost_currency, cost_kind, cost_source ORDER BY cost_currency, cost_kind, cost_source");
    let mut statement = connection.prepare(&sql)?;
    statement
        .query_map(params_from_iter(query_params), |row| {
            Ok(Money {
                currency: row.get(0)?,
                kind: row.get(1)?,
                source: row.get(2)?,
                amount: row.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

#[derive(Debug, Default)]
struct ReconciliationCost {
    values: Vec<Money>,
    latest_reconciled_at: Option<String>,
}

fn load_reconciliation_cost(connection: &Connection, scope: &Scope) -> Result<ReconciliationCost> {
    let mut sql = String::from(
        r#"
        SELECT currency, rovai_decimal_sum(provider_cost_decimal),
               MAX(reconciled_through_at)
        FROM runtime_cost_reconciliation_bucket
        WHERE collection_epoch = ? AND bucket_end_at > ? AND bucket_start_at < ?
        "#,
    );
    let mut params = vec![
        SqlValue::Text(scope.collection_epoch.clone()),
        SqlValue::Text(scope.from.to_rfc3339()),
        SqlValue::Text(scope.to.to_rfc3339()),
    ];
    if let Some(provider) = &scope.provider_key {
        sql.push_str(" AND provider_key = ?");
        params.push(SqlValue::Text(provider.clone()));
    }
    sql.push_str(" GROUP BY currency ORDER BY currency");
    let mut statement = connection.prepare(&sql)?;
    let rows = statement
        .query_map(params_from_iter(params), |row| {
            Ok((
                Money {
                    currency: row.get(0)?,
                    amount: row.get(1)?,
                    kind: "billing_bucket".to_string(),
                    source: "provider_reconciled".to_string(),
                },
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(ReconciliationCost {
        latest_reconciled_at: rows.iter().map(|(_, value)| value.clone()).max(),
        values: rows.into_iter().map(|(money, _)| money).collect(),
    })
}

fn cost_summary(run: Vec<Money>, reconciliation: ReconciliationCost) -> Result<Value> {
    if run.is_empty() && reconciliation.values.is_empty() {
        return Ok(Value::Null);
    }
    let mut run_by_currency = BTreeMap::new();
    for value in &run {
        let entry = run_by_currency
            .entry(value.currency.clone())
            .or_insert_with(|| "0".to_string());
        *entry = add_decimal(entry, &value.amount)?;
    }
    let mut differences = Vec::new();
    for value in &reconciliation.values {
        if let Some(run_amount) = run_by_currency.get(&value.currency) {
            differences.push(json!({
                "currency": value.currency,
                "amount": subtract_decimal_signed(&value.amount, run_amount)?,
            }));
        }
    }
    Ok(json!({
        "run": run.into_iter().map(money_json).collect::<Vec<_>>(),
        "reconciliation": reconciliation.values.into_iter().map(money_json).collect::<Vec<_>>(),
        "latestReconciledAt": reconciliation.latest_reconciled_at,
        "difference": differences,
    }))
}

fn money_json(value: Money) -> Value {
    json!({
        "amount": value.amount,
        "currency": value.currency,
        "kind": value.kind,
        "source": value.source,
    })
}

#[derive(Debug, Clone, Copy)]
enum BreakdownKind {
    Runtime,
    Model,
}

#[derive(Debug, Clone, Default)]
struct Breakdown {
    runtime_kind: String,
    provider_key: Option<String>,
    model_key: Option<String>,
    counters: UsageCounters,
    eligible_runs: i64,
    observed_runs: i64,
    cost: Vec<Money>,
}

fn load_breakdown(
    connection: &Connection,
    scope: &Scope,
    kind: BreakdownKind,
) -> Result<Vec<Value>> {
    let group = match kind {
        BreakdownKind::Runtime => "runtime_kind",
        BreakdownKind::Model => "runtime_kind, provider_key, model_key",
    };
    let select = match kind {
        BreakdownKind::Runtime => "runtime_kind, NULL, NULL",
        BreakdownKind::Model => "runtime_kind, provider_key, model_key",
    };
    let sql = format!(
        r#"
        SELECT {select},
               SUM(prompt_input_total_tokens), SUM(uncached_input_tokens),
               SUM(cache_read_tokens), SUM(cache_write_tokens),
               SUM(output_tokens), SUM(reasoning_output_tokens),
               SUM(cache_observable_request_count), SUM(cache_hit_request_count),
               COUNT(*),
               SUM(CASE WHEN prompt_input_total_tokens IS NOT NULL
                         OR output_tokens IS NOT NULL
                         OR cache_read_tokens IS NOT NULL
                         OR cache_write_tokens IS NOT NULL
                         OR cost_amount_decimal IS NOT NULL
                        THEN 1 ELSE 0 END)
        FROM runtime_usage_run_summary
        WHERE {}
        GROUP BY {group}
        "#,
        scope.where_sql
    );
    let mut statement = connection.prepare(&sql)?;
    let mut rows = statement
        .query_map(params_from_iter(scope.params.clone()), |row| {
            Ok(Breakdown {
                runtime_kind: row.get(0)?,
                provider_key: row.get(1)?,
                model_key: row.get(2)?,
                counters: UsageCounters {
                    prompt_input_total_tokens: row.get(3)?,
                    uncached_input_tokens: row.get(4)?,
                    cache_read_tokens: row.get(5)?,
                    cache_write_tokens: row.get(6)?,
                    output_tokens: row.get(7)?,
                    reasoning_output_tokens: row.get(8)?,
                    cache_observable_request_count: row.get(9)?,
                    cache_hit_request_count: row.get(10)?,
                },
                eligible_runs: row.get(11)?,
                observed_runs: row.get(12)?,
                cost: Vec::new(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(statement);
    attach_breakdown_cost(connection, scope, kind, &mut rows)?;
    if matches!(kind, BreakdownKind::Model) && rows.len() > MODEL_TOP_N {
        rows.sort_by_key(|row| {
            std::cmp::Reverse(
                row.counters
                    .prompt_input_total_tokens
                    .unwrap_or(0)
                    .saturating_add(row.counters.output_tokens.unwrap_or(0)),
            )
        });
        let rest = rows.split_off(MODEL_TOP_N);
        let mut other = Breakdown {
            runtime_kind: "other".to_string(),
            model_key: Some("其他".to_string()),
            ..Breakdown::default()
        };
        for row in rest {
            merge_breakdown(&mut other, row)?;
        }
        rows.push(other);
    }
    Ok(rows.into_iter().map(breakdown_json).collect())
}

fn attach_breakdown_cost(
    connection: &Connection,
    scope: &Scope,
    kind: BreakdownKind,
    rows: &mut [Breakdown],
) -> Result<()> {
    let group = match kind {
        BreakdownKind::Runtime => "runtime_kind, cost_currency, cost_kind, cost_source",
        BreakdownKind::Model => {
            "runtime_kind, provider_key, model_key, cost_currency, cost_kind, cost_source"
        }
    };
    let select = match kind {
        BreakdownKind::Runtime => "runtime_kind, NULL, NULL",
        BreakdownKind::Model => "runtime_kind, provider_key, model_key",
    };
    let mut sql = format!(
        r#"
        SELECT {select}, cost_currency, cost_kind, cost_source,
               rovai_decimal_sum(cost_amount_decimal)
        FROM runtime_usage_run_summary
        WHERE {} AND cost_amount_decimal IS NOT NULL
        "#,
        scope.where_sql
    );
    let mut query_params = scope.params.clone();
    if let Some(cost_kind) = &scope.cost_kind {
        sql.push_str(" AND cost_kind = ?");
        query_params.push(SqlValue::Text(cost_kind.clone()));
    }
    sql.push_str(&format!(" GROUP BY {group}"));
    let mut statement = connection.prepare(&sql)?;
    let costs = statement
        .query_map(params_from_iter(query_params), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                Money {
                    currency: row.get(3)?,
                    kind: row.get(4)?,
                    source: row.get(5)?,
                    amount: row.get(6)?,
                },
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (runtime, provider, model, money) in costs {
        if let Some(row) = rows.iter_mut().find(|row| {
            row.runtime_kind == runtime && row.provider_key == provider && row.model_key == model
        }) {
            row.cost.push(money);
        }
    }
    Ok(())
}

fn merge_breakdown(target: &mut Breakdown, incoming: Breakdown) -> Result<()> {
    merge_counter(
        &mut target.counters.prompt_input_total_tokens,
        incoming.counters.prompt_input_total_tokens,
    )?;
    merge_counter(
        &mut target.counters.uncached_input_tokens,
        incoming.counters.uncached_input_tokens,
    )?;
    merge_counter(
        &mut target.counters.cache_read_tokens,
        incoming.counters.cache_read_tokens,
    )?;
    merge_counter(
        &mut target.counters.cache_write_tokens,
        incoming.counters.cache_write_tokens,
    )?;
    merge_counter(
        &mut target.counters.output_tokens,
        incoming.counters.output_tokens,
    )?;
    merge_counter(
        &mut target.counters.reasoning_output_tokens,
        incoming.counters.reasoning_output_tokens,
    )?;
    merge_counter(
        &mut target.counters.cache_observable_request_count,
        incoming.counters.cache_observable_request_count,
    )?;
    merge_counter(
        &mut target.counters.cache_hit_request_count,
        incoming.counters.cache_hit_request_count,
    )?;
    target.eligible_runs += incoming.eligible_runs;
    target.observed_runs += incoming.observed_runs;
    for money in incoming.cost {
        if let Some(existing) = target.cost.iter_mut().find(|existing| {
            existing.currency == money.currency
                && existing.kind == money.kind
                && existing.source == money.source
        }) {
            existing.amount = add_decimal(&existing.amount, &money.amount)?;
        } else {
            target.cost.push(money);
        }
    }
    Ok(())
}

fn merge_counter(target: &mut Option<i64>, incoming: Option<i64>) -> Result<()> {
    if let Some(incoming) = incoming {
        *target = Some(
            target
                .unwrap_or(0)
                .checked_add(incoming)
                .context("Runtime Usage breakdown overflow")?,
        );
    }
    Ok(())
}

fn breakdown_json(row: Breakdown) -> Value {
    json!({
        "runtimeKind": row.runtime_kind,
        "providerKey": row.provider_key,
        "modelKey": row.model_key,
        "promptInputTotalTokens": row.counters.prompt_input_total_tokens,
        "uncachedInputTokens": row.counters.uncached_input_tokens,
        "cacheReadTokens": row.counters.cache_read_tokens,
        "cacheWriteTokens": row.counters.cache_write_tokens,
        "outputTokens": row.counters.output_tokens,
        "reasoningOutputTokens": row.counters.reasoning_output_tokens,
        "cacheReadShare": ratio(
            row.counters.cache_read_tokens,
            row.counters.prompt_input_total_tokens,
        ),
        "requestCacheHitRate": ratio(
            row.counters.cache_hit_request_count,
            row.counters.cache_observable_request_count,
        ),
        "cost": row.cost.into_iter().map(money_json).collect::<Vec<_>>(),
        "coverage": {
            "eligibleRuns": row.eligible_runs,
            "observedRuns": row.observed_runs,
        },
    })
}

fn load_trend(connection: &Connection, scope: &Scope) -> Result<Vec<Value>> {
    let hourly_bucket = if scope.daily_trend {
        "substr(bucket_start_at, 1, 10) || 'T00:00:00+00:00'"
    } else {
        "bucket_start_at"
    };
    let mut sql = format!(
        r#"
        SELECT {hourly_bucket},
               SUM(prompt_input_total_tokens), SUM(uncached_input_tokens),
               SUM(cache_read_tokens), SUM(cache_write_tokens),
               SUM(output_tokens), SUM(reasoning_output_tokens),
               SUM(cache_observable_request_count), SUM(cache_hit_request_count)
        FROM runtime_usage_hourly
        WHERE collection_epoch = ? AND bucket_start_at >= ? AND bucket_start_at < ?
        "#
    );
    let mut params = vec![
        SqlValue::Text(scope.collection_epoch.clone()),
        SqlValue::Text(scope.from.to_rfc3339()),
        SqlValue::Text(scope.to.to_rfc3339()),
    ];
    if let Some(runtime) = &scope.runtime_kind {
        sql.push_str(" AND runtime_kind = ?");
        params.push(SqlValue::Text(runtime.clone()));
    }
    if let Some(provider) = &scope.provider_key {
        sql.push_str(" AND provider_key = ?");
        params.push(SqlValue::Text(provider.clone()));
    }
    if let Some(model) = &scope.model_key {
        sql.push_str(" AND model_key = ?");
        params.push(SqlValue::Text(model.clone()));
    }
    sql.push_str(" GROUP BY 1 ORDER BY 1");
    let mut statement = connection.prepare(&sql)?;
    let rows = statement
        .query_map(params_from_iter(params), |row| {
            let cache_read: Option<i64> = row.get(3)?;
            let prompt_total: Option<i64> = row.get(1)?;
            let observable: Option<i64> = row.get(7)?;
            let hits: Option<i64> = row.get(8)?;
            Ok(json!({
                "bucketStartAt": row.get::<_, String>(0)?,
                "promptInputTotalTokens": prompt_total,
                "uncachedInputTokens": row.get::<_, Option<i64>>(2)?,
                "cacheReadTokens": cache_read,
                "cacheWriteTokens": row.get::<_, Option<i64>>(4)?,
                "outputTokens": row.get::<_, Option<i64>>(5)?,
                "reasoningOutputTokens": row.get::<_, Option<i64>>(6)?,
                "cacheReadShare": ratio(cache_read, prompt_total),
                "requestCacheHitRate": ratio(hits, observable),
                "cost": Value::Null,
            }))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut points = rows
        .into_iter()
        .map(|row| {
            (
                row["bucketStartAt"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                row,
            )
        })
        .collect::<BTreeMap<_, _>>();

    let summary_bucket = if scope.daily_trend {
        "substr(COALESCE(last_observed_at, enrolled_at), 1, 10) || 'T00:00:00+00:00'"
    } else {
        "substr(COALESCE(last_observed_at, enrolled_at), 1, 13) || ':00:00+00:00'"
    };
    let mut cost_sql = format!(
        r#"
        SELECT {summary_bucket}, cost_currency, cost_kind, cost_source,
               rovai_decimal_sum(cost_amount_decimal)
        FROM runtime_usage_run_summary
        WHERE {} AND cost_amount_decimal IS NOT NULL
        "#,
        scope.where_sql
    );
    let mut cost_params = scope.params.clone();
    if let Some(kind) = &scope.cost_kind {
        cost_sql.push_str(" AND cost_kind = ?");
        cost_params.push(SqlValue::Text(kind.clone()));
    }
    cost_sql.push_str(" GROUP BY 1, cost_currency, cost_kind, cost_source ORDER BY 1");
    let mut cost_statement = connection.prepare(&cost_sql)?;
    let cost_rows = cost_statement
        .query_map(params_from_iter(cost_params), |row| {
            Ok((
                row.get::<_, String>(0)?,
                Money {
                    currency: row.get(1)?,
                    kind: row.get(2)?,
                    source: row.get(3)?,
                    amount: row.get(4)?,
                },
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut costs = BTreeMap::<String, Vec<Money>>::new();
    for (bucket, money) in cost_rows {
        costs.entry(bucket).or_default().push(money);
    }
    for (bucket, values) in costs {
        let point = points.entry(bucket.clone()).or_insert_with(|| {
            json!({
                "bucketStartAt": bucket,
                "promptInputTotalTokens": Value::Null,
                "uncachedInputTokens": Value::Null,
                "cacheReadTokens": Value::Null,
                "cacheWriteTokens": Value::Null,
                "outputTokens": Value::Null,
                "reasoningOutputTokens": Value::Null,
                "cacheReadShare": Value::Null,
                "requestCacheHitRate": Value::Null,
                "cost": Value::Null,
            })
        });
        point["cost"] = Value::Array(values.into_iter().map(money_json).collect());
    }
    Ok(points.into_values().collect())
}

fn ratio(numerator: Option<i64>, denominator: Option<i64>) -> Option<f64> {
    match (numerator, denominator) {
        (Some(numerator), Some(denominator)) if denominator > 0 => {
            Some(numerator as f64 / denominator as f64)
        }
        _ => None,
    }
}

fn collection_identity(database: &Database) -> Result<(String, String)> {
    database
        .connection()
        .query_row(
            r#"
            SELECT collection_epoch, collection_started_at
            FROM runtime_usage_collection_state WHERE singleton_id = 1
            "#,
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(Into::into)
}

fn parse_time(value: &str) -> Result<DateTime<Utc>> {
    Ok(DateTime::parse_from_rfc3339(value)
        .with_context(|| format!("invalid Runtime Usage timestamp {value}"))?
        .with_timezone(&Utc))
}

fn hour_bucket(value: DateTime<Utc>) -> DateTime<Utc> {
    value
        .with_minute(0)
        .and_then(|value| value.with_second(0))
        .and_then(|value| value.with_nanosecond(0))
        .expect("valid UTC hour")
}

fn validate_key(value: &str, name: &str) -> Result<()> {
    if value.trim().is_empty() || value.len() > 256 {
        anyhow::bail!("Runtime Usage {name} is invalid");
    }
    Ok(())
}

fn validate_currency(value: &str) -> Result<()> {
    if value.len() != 3 || !value.bytes().all(|byte| byte.is_ascii_uppercase()) {
        anyhow::bail!("Runtime Usage currency must be a three-letter uppercase code");
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
        anyhow::bail!("Runtime Usage decimal must be an unsigned base-10 value");
    }
    Ok(())
}

fn add_decimal(left: &str, right: &str) -> Result<String> {
    validate_decimal(left)?;
    validate_decimal(right)?;
    let (left_whole, left_fraction) = decimal_parts(left);
    let (right_whole, right_fraction) = decimal_parts(right);
    let scale = left_fraction.len().max(right_fraction.len());
    let left_digits = format!(
        "{}{left_fraction:0<scale$}",
        left_whole.trim_start_matches('0')
    );
    let right_digits = format!(
        "{}{right_fraction:0<scale$}",
        right_whole.trim_start_matches('0')
    );
    let mut carry = 0_u8;
    let mut result = Vec::new();
    let width = left_digits.len().max(right_digits.len());
    let left = format!("{left_digits:0>width$}");
    let right = format!("{right_digits:0>width$}");
    for (left, right) in left.bytes().rev().zip(right.bytes().rev()) {
        let sum = (left - b'0') + (right - b'0') + carry;
        result.push((sum % 10) + b'0');
        carry = sum / 10;
    }
    if carry > 0 {
        result.push(carry + b'0');
    }
    result.reverse();
    decimal_from_digits(String::from_utf8(result)?, scale)
}

fn subtract_decimal_nonnegative(left: &str, right: &str) -> Result<Option<String>> {
    validate_decimal(left)?;
    validate_decimal(right)?;
    let (left_digits, right_digits, scale) = aligned_decimal_digits(left, right);
    if left_digits.len() < right_digits.len()
        || (left_digits.len() == right_digits.len() && left_digits < right_digits)
    {
        return Ok(None);
    }
    Ok(Some(subtract_aligned_digits(
        &left_digits,
        &right_digits,
        scale,
    )?))
}

fn subtract_decimal_signed(left: &str, right: &str) -> Result<String> {
    if let Some(value) = subtract_decimal_nonnegative(left, right)? {
        return Ok(value);
    }
    Ok(format!(
        "-{}",
        subtract_decimal_nonnegative(right, left)?.context("decimal ordering must be total")?
    ))
}

fn aligned_decimal_digits(left: &str, right: &str) -> (String, String, usize) {
    let (left_whole, left_fraction) = decimal_parts(left);
    let (right_whole, right_fraction) = decimal_parts(right);
    let scale = left_fraction.len().max(right_fraction.len());
    let left = format!(
        "{}{left_fraction:0<scale$}",
        left_whole.trim_start_matches('0')
    );
    let right = format!(
        "{}{right_fraction:0<scale$}",
        right_whole.trim_start_matches('0')
    );
    let width = left.len().max(right.len()).max(1);
    (
        format!("{left:0>width$}"),
        format!("{right:0>width$}"),
        scale,
    )
}

fn subtract_aligned_digits(left: &str, right: &str, scale: usize) -> Result<String> {
    let mut borrow = 0_i16;
    let mut result = Vec::with_capacity(left.len());
    for (left, right) in left.bytes().rev().zip(right.bytes().rev()) {
        let mut digit = i16::from(left - b'0') - borrow - i16::from(right - b'0');
        if digit < 0 {
            digit += 10;
            borrow = 1;
        } else {
            borrow = 0;
        }
        result.push(u8::try_from(digit)? + b'0');
    }
    result.reverse();
    decimal_from_digits(String::from_utf8(result)?, scale)
}

fn decimal_from_digits(mut digits: String, scale: usize) -> Result<String> {
    if digits.is_empty() {
        digits.push('0');
    }
    if scale == 0 {
        let whole = digits.trim_start_matches('0');
        return Ok(if whole.is_empty() { "0" } else { whole }.to_string());
    }
    if digits.len() <= scale {
        digits = format!("{digits:0>width$}", width = scale + 1);
    }
    let fraction_start = digits.len() - scale;
    let (whole, fraction) = digits.split_at(fraction_start);
    let whole = whole.trim_start_matches('0');
    let whole = if whole.is_empty() { "0" } else { whole };
    let fraction = fraction.trim_end_matches('0');
    Ok(if fraction.is_empty() {
        whole.to_string()
    } else {
        format!("{whole}.{fraction}")
    })
}

fn decimal_parts(value: &str) -> (&str, &str) {
    value.split_once('.').unwrap_or((value, ""))
}

fn decimal_is_zero(value: &str) -> bool {
    value
        .chars()
        .all(|character| character == '0' || character == '.')
}

fn cost_quality_rank(value: &str) -> u8 {
    match value {
        "runtime_reported" => 4,
        "runtime_estimate" => 3,
        "price_estimated" => 2,
        "tokenizer_price_estimated" => 1,
        _ => 0,
    }
}

fn non_empty(value: String) -> Option<String> {
    (!value.trim().is_empty()).then_some(value)
}

fn string_option(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
}

fn codex_cache_write_supported(runtime_version: Option<&str>) -> bool {
    runtime_version
        .and_then(parse_reported_version)
        .is_some_and(|version| version >= [0, 145, 0])
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
    validate_currency(currency).ok()?;
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
    let value = &params["tokenUsage"]["last"];
    let fields = RuntimeUsageFields {
        input_tokens: integer_at_any(value, &["/inputTokens"]),
        output_tokens: integer_at_any(value, &["/outputTokens"]),
        reasoning_output_tokens: integer_at_any(value, &["/reasoningOutputTokens"]),
        cache_read_input_tokens: integer_at_any(value, &["/cachedInputTokens"]),
        cache_write_input_tokens: integer_at_any(value, &["/cacheWriteInputTokens"]),
        context_used_tokens: None,
        context_size_tokens: None,
    };
    if fields.is_empty() {
        return Vec::new();
    }
    vec![ParsedRuntimeUsage {
        identity_suffix: "last".to_string(),
        dialect_id: "codex-thread-token-usage-v2".to_string(),
        source: "runtime_event".to_string(),
        scope: "turn".to_string(),
        counter_mode: RuntimeUsageCounterMode::Delta,
        input_semantics: RuntimeInputSemantics::CacheInclusiveTotal,
        native_session_id: string_at_any(params, &["/threadId"]),
        native_turn_id: string_at_any(params, &["/turnId"]),
        fields,
        cost: None,
        occurred_at: None,
    }]
}

pub fn codex_usage_source_identity(params: &Value) -> Result<String> {
    let thread_id = params
        .get("threadId")
        .and_then(Value::as_str)
        .context("Codex Usage notification is missing threadId")?;
    let total = params
        .pointer("/tokenUsage/total")
        .context("Codex Usage notification is missing tokenUsage.total")?;
    crate::command::canonical_json_digest(&json!({
        "dialectId": "codex-thread-token-usage-v2",
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
        let currency = string_at_any(update, &["/cost/currency"]);
        let cost = currency.as_deref().and_then(|currency| {
            cost_from_value(
                value_at_any(update, &["/cost/amount"]),
                currency,
                "runtime_reported",
                "session",
            )
        });
        if cost.is_none() {
            return Vec::new();
        }
        return vec![ParsedRuntimeUsage {
            identity_suffix: "usage_update".to_string(),
            dialect_id: "acp-usage-update-v2".to_string(),
            source: "runtime_event".to_string(),
            scope: "session".to_string(),
            counter_mode: RuntimeUsageCounterMode::Gauge,
            input_semantics: RuntimeInputSemantics::Unknown,
            native_session_id: string_at_any(params, &["/sessionId"]),
            native_turn_id: None,
            fields: RuntimeUsageFields::default(),
            cost,
            occurred_at: None,
        }];
    }
    if method != "rovai/acp_prompt_completed" || adapter_kind != AdapterKind::CopilotCli {
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
        context_used_tokens: None,
        context_size_tokens: None,
    };
    let currency = string_at_any(usage, &["/cost/currency"]);
    let cost = currency.as_deref().and_then(|currency| {
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
        dialect_id: "acp-copilot-usage-v2".to_string(),
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
        context_used_tokens: None,
        context_size_tokens: None,
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
        dialect_id: "claude-result-usage-v2".to_string(),
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

    fn usage(
        mode: RuntimeUsageCounterMode,
        semantics: RuntimeInputSemantics,
        input: Option<i64>,
        read: Option<i64>,
        write: Option<i64>,
        output: Option<i64>,
    ) -> ParsedRuntimeUsage {
        ParsedRuntimeUsage {
            identity_suffix: "fixture".to_string(),
            dialect_id: "fixture-v1".to_string(),
            source: "runtime_event".to_string(),
            scope: "turn".to_string(),
            counter_mode: mode,
            input_semantics: semantics,
            native_session_id: Some("session-1".to_string()),
            native_turn_id: Some("turn-1".to_string()),
            fields: RuntimeUsageFields {
                input_tokens: input,
                output_tokens: output,
                reasoning_output_tokens: None,
                cache_read_input_tokens: read,
                cache_write_input_tokens: write,
                context_used_tokens: None,
                context_size_tokens: None,
            },
            cost: None,
            occurred_at: None,
        }
    }

    #[test]
    fn usage_core_semantics_preserve_unknown_zero_and_partial_buckets() {
        let unknown = normalize_usage(&usage(
            RuntimeUsageCounterMode::Delta,
            RuntimeInputSemantics::CacheInclusiveTotal,
            None,
            None,
            None,
            None,
        ))
        .unwrap();
        assert_eq!(unknown, UsageCounters::default());

        let zero = normalize_usage(&usage(
            RuntimeUsageCounterMode::Delta,
            RuntimeInputSemantics::CacheInclusiveTotal,
            Some(0),
            Some(0),
            Some(0),
            Some(0),
        ))
        .unwrap();
        assert_eq!(zero.prompt_input_total_tokens, Some(0));
        assert_eq!(zero.uncached_input_tokens, Some(0));

        let partial = normalize_usage(&usage(
            RuntimeUsageCounterMode::Delta,
            RuntimeInputSemantics::CacheInclusiveTotal,
            Some(100),
            Some(40),
            None,
            Some(20),
        ))
        .unwrap();
        assert_eq!(partial.prompt_input_total_tokens, Some(100));
        assert_eq!(partial.cache_read_tokens, Some(40));
        assert_eq!(partial.uncached_input_tokens, None);

        assert!(
            normalize_usage(&usage(
                RuntimeUsageCounterMode::Delta,
                RuntimeInputSemantics::CacheInclusiveTotal,
                Some(30),
                Some(20),
                Some(20),
                Some(10),
            ))
            .is_err()
        );
    }

    #[test]
    fn cumulative_checkpoint_delta_and_decimal_arithmetic_are_exact() {
        let current = UsageCounters {
            prompt_input_total_tokens: Some(150),
            cache_read_tokens: Some(60),
            output_tokens: Some(30),
            ..UsageCounters::default()
        };
        let baseline = UsageCounters {
            prompt_input_total_tokens: Some(100),
            cache_read_tokens: Some(40),
            output_tokens: Some(20),
            ..UsageCounters::default()
        };
        let delta = subtract_counters(&current, &baseline);
        assert_eq!(delta.prompt_input_total_tokens, Some(50));
        assert_eq!(delta.cache_read_tokens, Some(20));
        assert_eq!(delta.output_tokens, Some(10));
        assert_eq!(
            subtract_decimal_nonnegative("15.25", "10.20").unwrap(),
            Some("5.05".to_string())
        );
        assert_eq!(add_decimal("10", "5").unwrap(), "15");
        assert_eq!(subtract_decimal_signed("10", "12.5").unwrap(), "-2.5");
    }

    #[test]
    fn cumulative_checkpoint_dedupes_advances_and_is_deleted_at_terminal() {
        let directory = std::env::temp_dir().join(format!(
            "rovai-runtime-usage-checkpoint-{}",
            uuid::Uuid::new_v4()
        ));
        let mut database = Database::open(&directory).unwrap();
        let (epoch, started_at) = collection_identity(&database).unwrap();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO runtime_usage_run_summary(
                    collection_epoch, agent_run_id, runtime_kind,
                    parser_version, eligible_mask, input_semantics, enrolled_at
                ) VALUES(?1, 'run-1', 'codex-cli', 2, 127, 'unknown', ?2)
                "#,
                params![epoch, started_at],
            )
            .unwrap();
        let run = RuntimeUsageRun {
            key: UsageRunKey {
                agent_run_id: "run-1".to_string(),
                execution_epoch: 1,
            },
            runtime_kind: AdapterKind::CodexCli,
            runtime_version: Some("1.0".to_string()),
            provider_key: Some("openai".to_string()),
            model_key: Some("gpt-test".to_string()),
            service_tier: None,
        };
        let persist =
            |database: &mut Database, source_identity: &str, input: i64, read: i64, output: i64| {
                let parsed = usage(
                    RuntimeUsageCounterMode::Cumulative,
                    RuntimeInputSemantics::CacheInclusiveTotal,
                    Some(input),
                    Some(read),
                    None,
                    Some(output),
                );
                MonitoringService::record_usage_batches(
                    database,
                    &[RuntimeUsageFlushBatch {
                        run: run.clone(),
                        records: vec![BufferedUsageRecord {
                            key: BufferedUsageKey::new(&run.key, &parsed),
                            usage: parsed,
                            source_identities: vec![source_identity.to_string()],
                        }],
                        pending_since: Instant::now(),
                    }],
                )
                .unwrap();
            };

        persist(&mut database, "event-1", 100, 40, 20);
        persist(&mut database, "event-2", 100, 40, 20);
        let before_advance: (Option<i64>, Option<i64>, Option<i64>) = database
            .connection()
            .query_row(
                r#"
                SELECT prompt_input_total_tokens, cache_read_tokens, output_tokens
                FROM runtime_usage_run_summary WHERE agent_run_id = 'run-1'
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(before_advance, (None, None, None));

        persist(&mut database, "event-3", 150, 60, 30);
        persist(&mut database, "event-4", 150, 60, 30);
        let after_advance: (Option<i64>, Option<i64>, Option<i64>) = database
            .connection()
            .query_row(
                r#"
                SELECT prompt_input_total_tokens, cache_read_tokens, output_tokens
                FROM runtime_usage_run_summary WHERE agent_run_id = 'run-1'
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(after_advance, (Some(50), Some(20), Some(10)));
        let checkpoint_count: i64 = database
            .connection()
            .query_row("SELECT COUNT(*) FROM runtime_usage_checkpoint", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(checkpoint_count, 1);

        assert!(MonitoringService::finalize_usage_run(&mut database, "run-1").unwrap());
        let checkpoint_count: i64 = database
            .connection()
            .query_row("SELECT COUNT(*) FROM runtime_usage_checkpoint", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(checkpoint_count, 0);
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn runtime_parsers_emit_sparse_usage_without_antigravity_inference() {
        let codex: Value =
            serde_json::from_str(include_str!("../tests/fixtures/runtime-usage/codex.json"))
                .unwrap();
        let parsed = parse_codex_usage_message(codex["method"].as_str().unwrap(), &codex["params"]);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].counter_mode, RuntimeUsageCounterMode::Delta);
        assert_eq!(parsed[0].fields.input_tokens, Some(120));
        assert_eq!(
            eligible_mask(AdapterKind::CodexCli, None) & ELIGIBLE_CACHE_WRITE,
            0,
            "unknown Codex versions must not claim Cache Write eligibility"
        );
        assert_ne!(
            eligible_mask(AdapterKind::CodexCli, Some("codex-cli 0.145.0")) & ELIGIBLE_CACHE_WRITE,
            0
        );

        let copilot: Value =
            serde_json::from_str(include_str!("../tests/fixtures/runtime-usage/copilot.json"))
                .unwrap();
        let copilot_usage = parse_acp_usage_message(
            AdapterKind::CopilotCli,
            copilot["method"].as_str().unwrap(),
            &copilot["params"],
        );
        assert_eq!(copilot_usage[0].fields.cache_write_input_tokens, Some(10));

        let claude: Value =
            serde_json::from_str(include_str!("../tests/fixtures/runtime-usage/claude.json"))
                .unwrap();
        let claude_usage = parse_claude_result_usage(&claude);
        assert_eq!(claude_usage[0].fields.cache_read_input_tokens, Some(25));
        assert_eq!(claude_usage[0].cost.as_ref().unwrap().amount, "0.0042");

        for (runtime, fixture) in [
            (
                AdapterKind::OpencodeCli,
                include_str!("../tests/fixtures/runtime-usage/opencode.json"),
            ),
            (
                AdapterKind::KiroCli,
                include_str!("../tests/fixtures/runtime-usage/kiro.json"),
            ),
            (
                AdapterKind::QoderCli,
                include_str!("../tests/fixtures/runtime-usage/qoder.json"),
            ),
            (
                AdapterKind::CodebuddyCli,
                include_str!("../tests/fixtures/runtime-usage/codebuddy.json"),
            ),
            (
                AdapterKind::QwenCode,
                include_str!("../tests/fixtures/runtime-usage/qwen.json"),
            ),
            (
                AdapterKind::TraeCnCli,
                include_str!("../tests/fixtures/runtime-usage/trae.json"),
            ),
        ] {
            let fixture: Value = serde_json::from_str(fixture).unwrap();
            assert!(
                parse_acp_usage_message(
                    runtime,
                    fixture["method"].as_str().unwrap(),
                    &fixture["params"],
                )
                .is_empty(),
                "Context-only ACP usage_update must not be stored as Token Usage"
            );
        }
        let acp_cost = json!({
            "sessionId": "session-1",
            "update": {
                "sessionUpdate": "usage_update",
                "cost": { "amount": "1.25", "currency": "USD" }
            }
        });
        let acp_cost_usage =
            parse_acp_usage_message(AdapterKind::OpencodeCli, "session/update", &acp_cost);
        assert_eq!(
            acp_cost_usage[0].counter_mode,
            RuntimeUsageCounterMode::Gauge
        );
        assert_eq!(acp_cost_usage[0].cost.as_ref().unwrap().amount, "1.25");
        let mut missing_currency = acp_cost;
        missing_currency["update"]["cost"] = json!({ "amount": "1.25" });
        assert!(
            parse_acp_usage_message(
                AdapterKind::OpencodeCli,
                "session/update",
                &missing_currency,
            )
            .is_empty()
        );

        let antigravity: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/runtime-usage/antigravity.json"
        ))
        .unwrap();
        assert!(parse_claude_result_usage(&antigravity).is_empty());
    }

    #[test]
    fn snapshot_contract_contains_usage_only() {
        let directory = std::env::temp_dir().join(format!(
            "rovai-runtime-usage-snapshot-{}",
            uuid::Uuid::new_v4()
        ));
        let mut database = Database::open(&directory).unwrap();
        let now = Utc::now();
        let collection_started_at = (now - Duration::days(40)).to_rfc3339();
        database
            .connection()
            .execute(
                "UPDATE runtime_usage_collection_state SET collection_started_at = ?1",
                [&collection_started_at],
            )
            .unwrap();
        let (epoch, _) = collection_identity(&database).unwrap();
        let empty = MonitoringService::snapshot(
            &mut database,
            &MonitoringFilter {
                range: "24h".to_string(),
                runtime_kind: None,
                provider_key: None,
                model_key: None,
                cost_kind: None,
            },
        )
        .unwrap();
        assert_eq!(empty["summary"]["promptInputTotalTokens"], Value::Null);
        assert_eq!(
            empty["coverage"]["promptInputTotalTokens"]["eligibleRuns"],
            0
        );
        database
            .connection()
            .execute(
                r#"
                INSERT INTO runtime_usage_run_summary(
                    collection_epoch, agent_run_id, runtime_kind, runtime_version,
                    provider_key, model_key, service_tier, parser_version,
                    eligible_mask, input_semantics, usage_source, usage_quality,
                    prompt_input_total_tokens, uncached_input_tokens,
                    cache_read_tokens, cache_write_tokens, output_tokens,
                    reasoning_output_tokens, cache_observable_request_count,
                    cache_hit_request_count, cost_amount_decimal, cost_currency,
                    cost_kind, cost_source, pricing_catalog_version,
                    enrolled_at, first_observed_at, last_observed_at, finalized_at
                ) VALUES (
                    ?1, 'run-1', 'codex-cli', '1.0', 'openai', 'gpt-test',
                    NULL, 2, 255, 'cache_inclusive_total',
                    'runtime_event', 'runtime_reported',
                    100, NULL, 40, NULL, 20, 5, 1, 1,
                    NULL, NULL, NULL, NULL, NULL, ?2, ?2, ?2, ?2
                )
                "#,
                params![epoch, now.to_rfc3339()],
            )
            .unwrap();
        for age in [1_i64, 48, 240] {
            let bucket = hour_bucket(now - Duration::hours(age)).to_rfc3339();
            database
                .connection()
                .execute(
                    r#"
                    INSERT INTO runtime_usage_hourly(
                        collection_epoch, bucket_start_at, runtime_kind,
                        provider_key, model_key, prompt_input_total_tokens,
                        last_updated_at
                    ) VALUES(?1, ?2, 'codex-cli', 'openai', 'gpt-test', 10, ?3)
                    "#,
                    params![epoch, bucket, now.to_rfc3339()],
                )
                .unwrap();
        }
        let filter = |range: &str| MonitoringFilter {
            range: range.to_string(),
            runtime_kind: None,
            provider_key: None,
            model_key: None,
            cost_kind: None,
        };
        let snapshot = MonitoringService::snapshot(&mut database, &filter("24h")).unwrap();
        assert_eq!(snapshot["schemaVersion"], 2);
        assert_eq!(snapshot["summary"]["promptInputTotalTokens"], 100);
        assert_eq!(snapshot["summary"]["uncachedInputTokens"], Value::Null);
        assert_eq!(snapshot["trend"].as_array().unwrap().len(), 1);
        assert_eq!(
            MonitoringService::snapshot(&mut database, &filter("7d")).unwrap()["trend"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            MonitoringService::snapshot(&mut database, &filter("30d")).unwrap()["trend"]
                .as_array()
                .unwrap()
                .len(),
            3
        );
        assert!(snapshot.get("reliability").is_none());
        assert!(snapshot.get("sessions").is_none());
        assert!(snapshot.get("toolDuration").is_none());
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
