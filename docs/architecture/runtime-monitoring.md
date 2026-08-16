---
document_type: architecture
architecture: runtime-monitoring
authority: runtime-usage-collection-rollup-and-read-boundaries
status: accepted
last_updated: 2026-08-16
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
| Raw Usage Store | 对一个 source observation 追加一次稀疏数字/身份/语义事实；幂等身份独立于 parser version，不保存正文 |
| Normalized Usage Projection | 把已证明的 raw 字段归一化到互斥输入桶、输出子类、Context gauge 和 cost layer；版本化、可重建、不补缺失值 |
| Parser State | 按 epoch/session/model/counter family 保存 cumulative baseline、segment、cursor 与 reset；不保存 transcript 正文 |
| Native Session Fact | 记录 enrollment Run 的 resume request、launch disposition、实际 outcome、fallback 和 reason；旧 attempt 不回填 |
| Canonical Runtime Activity | 继续拥有可观察 operation identity、phase、outcome 和 Activity Coverage；Usage 不进入此 authority |
| Monitoring Rollup | 从 enrollment、Core facts 和 normalized Usage 构建小时级 additive totals、counts 和可合并 distribution sketch；可从当前 epoch 重建 |
| Monitoring Read Service | 在单一 SQLite read transaction 中应用 collection clamp、range/filter/eligibility，组装 summary/usage/reliability 和每项 Coverage |
| Runtime Fleet Snapshot | 提供当前 active/warm/burst Host 的 data-minimized 计数；历史只从 cutover 后明确样本开始 |
| Provider Billing Integration | 后续以独立凭据/同步边界写 Provider Billing Bucket；没有 linkage 时保持聚合，不写精确 Run cost |
| Electron Main / Preload | 只 allowlist 三个 typed read method 和用户发起的脱敏导出；不直读 SQLite、Runtime logs 或 Provider credential |
| Renderer Monitoring Surface | 展示 Core response、range/filter、Coverage、quality、freshness 和 collection boundary；不重算权威指标或推断缺失值 |

## Collection and parsing flow

```text
new AgentRun execution admission
  -> Monitoring Run Enrollment(collection epoch + frozen support)

Runtime native message/result
  -> existing Transport route binds AgentRun + execution epoch
  -> adapter/version Usage Dialect parses sparse fields
  -> Raw Usage Store deduplicates source identity
  -> validation + cumulative/gauge state
  -> Normalized Usage Projection
  -> hourly rollup invalidation/rebuild input

Core lifecycle / Delivery / Approval / Context / Compaction / Probe
Canonical Runtime Activity
Normalized Usage Projection
  -> Monitoring Read Service(collection clamp + filter + eligibility)
  -> summary | usage | reliability
  -> typed Desktop bridge
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
  prompt terminal Usage as a separate boundary. OpenCode, Copilot, Kiro, Qoder, CodeBuddy, Qwen and TRAE use separate
  dialect/version entries for private fields.
- **Antigravity:** no native Usage dialect is enabled. An optional versioned local tokenizer writes only
  `tokenizer_estimated` input/final-output observations and never Cache or native Coverage.

## Existing fact composition

Monitoring does not copy existing facts into a second authority. The Read Service joins enrolled Run IDs to current
AgentRun, Runtime Input Delivery, Approval, ContextManifest, Compaction, Probe and Canonical Activity tables. Rollups may
cache counts/distributions, but their lineage remains the authoritative rows and current-epoch Usage projection.

Tool Duration derives only from strict operation identity. `pairedElapsedSum` answers accumulated call time;
`wallClockUnion` answers how much clock time was covered by one or more paired Tool calls. Parallel calls make those
values intentionally different. Run-level or unpaired activity can raise eligible/partial counts but contributes no
duration.

## Cost and billing composition

Runtime cost, public-price estimate and Provider billing remain separate stores/qualities. A `bestAvailable` selector
first partitions by grain, filter dimensions, time range and currency, then chooses the strongest available source
inside that partition. It never replaces preserved lower layers.

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
