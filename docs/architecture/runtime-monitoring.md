---
document_type: architecture
architecture: runtime-monitoring
authority: runtime-usage-collection-rollup-and-read-boundaries
status: accepted
last_updated: 2026-08-17
---

# Runtime Monitoring 架构

字段、方法和指标口径见 [Runtime Monitoring v1](../contracts/runtime-monitoring-v1.md)。长期来源诚实、
clean-break enrollment 与成本 grain 由 [ADR-0201](../adr/0201-sparse-runtime-usage-and-clean-break-monitoring.md)
拥有。本架构只说明 Transport、Observation、Projection、Rollup、Read Side 和 Renderer 怎样组合。

## Component authority

| Component | Responsibility |
| --- | --- |
| Monitoring Collection State | 持久保存唯一 current collection epoch、schema version 和 cutover；不删除或迁移旧 Core 事实 |
| Monitoring Run Enrollment | 在新 AgentRun/execution epoch 的执行准入点冻结 adapter、Runtime version、model config 和 parser/capability support；决定监控 eligible universe |
| Runtime Transport | 继续拥有 Codex app-server、Claude stream-json、ACP 和 Antigravity 进程/消息边界；不直接聚合产品指标 |
| Runtime Usage Dialect Registry | 按 adapter + Runtime/protocol version 选择字段路径、scope、counter/input/reasoning/cost semantics 和 parser version；未经 Fixture 不开放私有字段 |
| Runtime Usage Buffer | 在内存按 Run/source semantics 去重并合并稀疏更新；全局 4 秒节拍批量 drain，终态/Host exit/shutdown 强制 drain |
| Raw Usage Store | 每次 flush 保存一条或多条 coalesced 稀疏数字/身份/语义事实，并单独保存 constituent source dedupe digest；不保存正文 |
| Normalized Usage Projection | 把已证明的 raw 字段归一化到互斥输入桶、输出子类、Context gauge 和 cost layer；版本化、可重建、不补缺失值 |
| Parser State | 按 epoch/session/model/counter family 保存 cumulative baseline、segment、cursor 与 reset；不保存 transcript 正文 |
| Native Session Fact | 记录 enrollment Run 的 resume request、launch disposition、实际 outcome、fallback 和 reason；旧 attempt 不回填 |
| Canonical Runtime Activity | 继续拥有可观察 operation identity、phase、outcome 和 Activity Coverage；Usage 不进入此 authority |
| Monitoring Rollup | 写入时维护 Run Usage/Cost 与小时级 Usage/Run status rollup；历史趋势只读 rollup，不扫描 Evidence/Transcript |
| Monitoring Read Service | 唯一 `monitoring.snapshot` 在单一 SQLite read transaction 中应用 collection clamp、range/filter/eligibility，一次组装三个子视图和 Coverage |
| Runtime Fleet Snapshot | 提供当前 active/warm/burst Host 的 data-minimized 计数；历史只从 cutover 后明确样本开始 |
| Provider Billing Integration | 后续以独立后台同步边界写 Provider Billing Bucket；看板只读已保存结果，open/refresh 永不触发对账 |
| Electron Main / Preload | 只 allowlist `monitoring.snapshot` 和用户发起的脱敏导出；导出复用同一快照，不直读 SQLite/日志/凭据 |
| Renderer Monitoring Surface | 展示同一快照的三个 Tab；可见时每 12 秒轮询，普通持久化事件同时受 300ms debounce 与 10 秒成功请求间隔约束，终态事件可立即刷新，隐藏/卸载即停止 |

## Collection and parsing flow

```text
new AgentRun execution admission
  -> Monitoring Run Enrollment(collection epoch + frozen support)

Runtime native message/result
  -> existing Transport route binds AgentRun + execution epoch
  -> adapter/version Usage Dialect parses sparse fields
  -> in-memory Usage Buffer deduplicates/coalesces
  -> four-second batch or forced terminal flush
  -> Raw Usage Store persists coalesced values + source dedupe identities
  -> validation + cumulative/gauge state
  -> Normalized Usage Projection
  -> Run/hour rollups updated in the same short transaction

Core lifecycle / Delivery / Approval / Context / Compaction / Probe
Canonical Runtime Activity
Run/hour rollups + narrow Core projections
  -> monitoring.snapshot(collection clamp + filter + eligibility)
  -> { summary, usage, reliability }
  -> one typed Desktop bridge call
  -> Renderer
```

Transport parsing is best-effort with respect to AgentRun completion. A malformed Usage event records a bounded
diagnostic and reduces Coverage; it cannot seize Runtime terminal authority or fail an otherwise reliable Run. The
exception is storage corruption or a violated Core transaction invariant, which follows normal Core failure handling
rather than silently dropping authoritative state.

## Clean-break enrollment

Migration creates a new collection epoch and empty monitoring tables. It does not enumerate old AgentRuns. Enrollment
occurs only for a new execution epoch after the cutover, so a Run already active while the app upgrades remains outside
monitoring even if its terminal arrives later. Recovery of an enrolled v0.96 Run remains enrolled; an old Run does not
become eligible merely because it is recovered by a new Core generation.

Each recovered execution keeps its own enrollment for epoch-bound Usage, Session and Activity lineage. The read side
collapses lifecycle, trend and Coverage to one logical `(collectionEpoch, agentRunId)`: only the first enrollment adds
the Run rollup, later epochs inherit its logical bucket, and the AgentRun terminal trigger migrates that single row.
Additive delta Usage may span epochs, while observed sets and latest Context remain keyed by logical AgentRun.

Every query returns:

```text
collectionEpoch
collectionStartedAt
requestedStartAt
effectiveStartAt = max(requestedStartAt, collectionStartedAt)
observedAt
```

All joins begin from Monitoring Run Enrollment. Lifecycle rows that exist without enrollment are intentionally absent.
This preserves a consistent denominator across lifecycle, Usage and Session views and makes the lack of history visible
instead of creating a dashboard where only some old metrics are populated.

## Sparse Usage and parser state

A Runtime Usage Dialect returns a presence-aware record; it never returns a fully defaulted object. Input semantics are
validated before deriving mutually exclusive `uncached/read/write` buckets. Invalid relationships remain unknown and
produce a parser diagnostic. Reasoning/Thought is a nested Output classification unless a Runtime Fixture proves an
exclusive bucket.

Counter handling is explicit:

| Counter mode | Handling |
| --- | --- |
| `delta` | Append once and add after source dedupe |
| `cumulative` | Compare with a same-session/model/field segment baseline; reset opens a new segment |
| `gauge` | Keep observation/latest value for Context or Session state; never add across time |

Resume can expose totals that began before the enrolled Run. If no reliable start baseline exists, the observation
remains a Session Gauge and does not become Run Token/Cost. Transcript fallback is allowed only for a fixed Runtime
path/version/Fixture and an incremental bounded parser; v0.96 clean break does not scan older transcripts.

## Adapter paths

- **Claude Code:** result/modelUsage and deduplicated assistant usage enter the dialect; result and per-call values
  cannot be summed across overlapping scope. Runtime-reported dollars remain an estimate.
- **Codex CLI:** `thread/tokenUsage/updated` preserves last/total/context and input/cache-write/output/reasoning fields;
  Fixture decides delta semantics and resume baseline.
- **ACP:** the common parser reads standard `usage_update` as Context Gauge plus optional cumulative Session Cost and
  prompt terminal Usage as a separate boundary. Standard cost requires both amount and an explicit valid currency;
  missing currency remains unknown. OpenCode, Copilot, Kiro, Qoder, CodeBuddy, Qwen and TRAE use separate dialect/version
  entries for private fields.
- **Antigravity:** no native Usage dialect is enabled. An optional versioned local tokenizer writes only
  `tokenizer_estimated` input/final-output observations and never Cache or native Coverage.

## Existing fact composition

Monitoring does not copy existing facts into a second authority. The Read Service joins enrolled Run IDs to current
AgentRun, Runtime Input Delivery, Approval, Compaction and Canonical Activity tables. ContextManifest omission,
Bootstrap redelivery and Runtime Probe/auth/active-host composition remain explicit implementation-plan gaps; enrolled
Run health is not presented as a substitute. Rollups may cache counts/distributions, but their lineage remains the
authoritative rows and current-epoch Usage projection.

Tool Duration derives only from strict operation identity. `pairedElapsedSum` answers accumulated call time;
`wallClockUnion` answers how much clock time was covered by one or more paired Tool calls. Parallel calls make those
values intentionally different. Run-level or unpaired activity can raise eligible/partial counts but contributes no
duration.

## Database mutex and refresh discipline

Core currently owns one Database Mutex. Monitoring therefore keeps database critical sections deliberately narrow:

- Runtime event handling only performs a scalar enrollment lookup before buffering; it does not write on each update;
- a single global four-second tick flushes all pending Usage in one transaction, while a terminal boundary bypasses the
  cadence and forces that Run's pending batch;
- Execution Evidence keeps first-visible activity durable in the admitting transaction, but only while that scalar is
  still `NULL`; Evidence count increments are coalesced in memory, flushed on the same four-second cadence, and replaced
  with an exact indexed count at terminal/Host-exit boundaries;
- enrollment projects Usage capability booleans, first-visible activity and Evidence counts so snapshot assembly does
  not parse per-Run capability JSON or scan immutable Evidence;
- trend queries read `monitoring_run_rollup_hourly`; lifecycle/P95 and Usage/Context return scalar aggregates, while
  Runtime/Model breakdowns return controlled dimension groups; exact decimal Cost is selected per logical Run and
  aggregated inside SQLite; Delivery/Approval P95 and Tool timing count/sum/wall-clock union likewise use indexed SQL
  CTE/window aggregation rather than materializing unbounded Run, Usage, Cost or activity detail rows in Core;
- no monitoring critical section reads a Managed Blob, parses a Runtime Transcript, performs a network request or
  starts Provider reconciliation.

The Renderer owns one 12-second visible-page interval regardless of the number of cards. A periodic four-second Usage
flush advances stored facts without emitting an immediate `monitoring.changed`; the next visible-page poll reads it.
Other non-terminal persisted-fact events use a 300ms debounce and may not start a background snapshot less than 10
seconds after the last successful request. `agent_run.terminal` and visibility restoration may bypass that interval so
terminal and stale foreground state converge promptly. A single-flight gate coalesces overlapping
poll/event/manual/filter triggers instead of queueing concurrent Database Mutex work. `visibilitychange` stops/restarts
polling, and component unmount cancels timers/subscription. Core emits structured snapshot timing with Database Mutex
wait and query duration so a separate SQLite read connection is considered only from measured need and its own
concurrency contract.

## Cost and billing composition

Runtime cost, public-price estimate and Provider billing remain separate stores/qualities. A `bestAvailable` selector
first partitions by logical Run, grain, filter dimensions, time range and currency, chooses the strongest available
source per Run, then sums the selected rows while preserving mixed quality labels. It never replaces preserved lower
layers or drops a lower-quality value belonging to a Run that has no higher-quality match.

Provider billing sync is outside the monitoring read module and outside the monitoring page's configuration. A bucket
without request linkage or an isolated project/API-key dimension can be compared at aggregate range only. Any explicit
allocation has its own `allocated` quality and cannot be relabeled reconciled Run cost.

## Failure and privacy boundaries

- Usage parser failure: preserve the Run, record bounded diagnostics, expose partial Coverage;
- rollup failure/staleness: retain last-good rollup with freshness marker or query bounded detail; never show current
  without evidence;
- query failure: preserve filters and last content in Renderer, show local retry;
- unsupported field: return unavailable/`NULL`, not an error and not zero;
- export: only aggregate metrics, collection boundary, source/quality and data-minimized Runtime/model labels; no prompt,
  completion, Tool output, Memory, attachment body, absolute path or naked native ID;
- derived-data cleanup: may clear raw/normalized/rollup monitoring tables under its explicit policy, but never deletes
  Core execution, Approval, Context, Recovery, Evidence or Provider credentials.

## References

- [ADR-0201](../adr/0201-sparse-runtime-usage-and-clean-break-monitoring.md)
- [Runtime Monitoring v1](../contracts/runtime-monitoring-v1.md)
- [v0.96 implementation plan](../versions/v0.96/implementation-plan.md)
- [Runtime monitoring feasibility audit](../research/runtime-monitoring/README.md)
- [ADR-0013](../adr/0013-managed-content-and-read-side-v2.md)
- [ADR-0111](../adr/0111-core-owned-canonical-runtime-activity.md)
- [ADR-0112](../adr/0112-immutable-execution-evidence-and-rebuildable-canonical-activity-projection.md)
- [ADR-0117](../adr/0117-observation-capability-coverage-levels-across-runtime-adapters.md)
- [ADR-0148](../adr/0148-read-only-diagnostics-and-data-minimized-export.md)
