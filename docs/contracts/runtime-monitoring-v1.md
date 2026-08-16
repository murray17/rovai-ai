---
document_type: contract
name: Runtime Monitoring
version: v1
status: accepted
source_version: v0.96
last_updated: 2026-08-16
---

# Runtime Monitoring v1

本合同冻结 v0.96 的 Monitoring Collection、Runtime Usage Observation、Native Session fact、三个只读
查询、Coverage、Tool Duration 和 Cost layer。架构组合见
[Runtime Monitoring](../architecture/runtime-monitoring.md)，长期来源与 clean-break 决策见
[ADR-0201](../adr/0201-sparse-runtime-usage-and-clean-break-monitoring.md)。

本合同只服务 Core → Electron Main → Renderer 的应用级运行监控。它不进入 Agent Built-in CLI、Runtime
tool catalog、Camp/Conversation Message、Native Session Bootstrap、AgentRun Dynamic Context、Memory、FTS
或 AgentRun Execution Evidence。

## Collection boundary and enrollment

Core 持久化唯一 current collection state：

```ts
interface MonitoringCollectionBoundary {
  schemaVersion: 1
  collectionEpoch: string
  collectionStartedAt: string
  requestedStartAt: string
  effectiveStartAt: string
  endAt: string
  observedAt: string
}
```

`collectionEpoch` 是不可猜测的稳定 ID。`effectiveStartAt = max(requestedStartAt, collectionStartedAt)`。
`endAt` 为查询捕获的上界；`observedAt` 为同一响应组装时间。所有时间是 UTC RFC 3339。

每个 eligible execution 必须存在：

```ts
interface MonitoringRunEnrollment {
  collectionEpoch: string
  agentRunId: string
  executionEpoch: number
  adapterKind: AdapterKind
  runtimeVersion: string | null
  modelSelection: unknown
  parserSupportSnapshot: RuntimeUsageSupportSnapshot
  enrolledAt: string
}

interface RuntimeUsageSupportSnapshot {
  dialectId: string | null
  parserVersion: string | null
  nativeFields: {
    input: boolean
    output: boolean
    reasoningOutput: boolean
    cacheRead: boolean
    cacheWrite: boolean
    contextUsed: boolean
    contextWindow: boolean
    reportedCost: boolean
  }
  toolDurationCoverage: 'fine_grained' | 'run_level' | 'unknown'
  compactionObservable: boolean
}
```

Enrollment 以 `(collectionEpoch, agentRunId, executionEpoch)` 唯一。只有在 current collection epoch 生效后
新准入的 execution 才能建立。Migration 不为旧 Run 建行；cutover 时已经 active 的 execution 也不建立。
所有监控查询必须先从 Enrollment 限定集合，不能从 AgentRun 时间戳反向制造 enrollment。

## Runtime Usage Observation

### Raw identity

```ts
type RuntimeUsageScope = 'model_call' | 'turn' | 'run' | 'session'
type RuntimeUsageCounterMode = 'delta' | 'cumulative' | 'gauge'
type RuntimeInputSemantics =
  | 'exclusive_buckets'
  | 'cache_inclusive_total'
  | 'unknown'

type RuntimeUsageSource =
  | 'runtime_event'
  | 'runtime_result'
  | 'runtime_private_extension'
  | 'provider_usage_api'
  | 'local_tokenizer'

interface RuntimeUsageRawObservation {
  id: string
  collectionEpoch: string
  agentRunId: string
  executionEpoch: number
  adapterKind: AdapterKind
  runtimeVersion: string | null
  dialectId: string
  source: RuntimeUsageSource
  scope: RuntimeUsageScope
  counterMode: RuntimeUsageCounterMode
  sourceIdentityDigest: string
  nativeSessionDigest: string | null
  nativeTurnDigest: string | null
  nativeRequestDigest: string | null
  modelId: string | null
  provider: string | null
  serviceTier: string | null
  inputSemantics: RuntimeInputSemantics
  fields: RuntimeUsageFields
  cost: RuntimeUsageCost | null
  observedAt: string
}
```

`sourceIdentityDigest` 在同一 Adapter source scope 内唯一，且唯一约束不包含 parser version。同一个原始
事件由新 parser 重放时不能成为第二笔 Usage。所有 Native ID 在持久化前使用本机密钥 digest；响应与导出
不返回这些 digest。

`RuntimeUsageFields` 的每个字段都允许 `null`：

```ts
interface RuntimeUsageFields {
  rawInputTokens: number | null
  uncachedInputTokens: number | null
  cacheReadInputTokens: number | null
  cacheWriteInputTokens: number | null
  outputTokens: number | null
  reasoningOutputTokens: number | null
  contextUsedTokens: number | null
  contextWindowTokens: number | null
}
```

所有非空 Token 必须是安全整数且 `>= 0`。字段缺失保存 `null`；Runtime 明确上报 `0` 保存 0。
`reasoningOutputTokens` 默认是 `outputTokens` 的子分类，不进入 `input + output` 之外的 total。

### Normalized projection

```ts
interface RuntimeUsageNormalizedObservation {
  rawObservationId: string
  parserVersion: string
  projectionVersion: 1
  fields: RuntimeUsageFields
  normalizationStatus: 'complete' | 'partial' | 'invalid'
  diagnosticCode: string | null
}
```

归一化规则：

- `exclusive_buckets`：原生普通 Input、Cache Read、Cache Write 直接映射为互斥桶；
- `cache_inclusive_total`：仅当 `rawInput >= cacheRead + cacheWrite` 且两个 Cache 桶都已知时，
  `uncached = rawInput - cacheRead - cacheWrite`；
- 任一依赖桶未知时，不补零；依赖该桶的派生值保持 `null`；
- `rawInput < cacheRead + cacheWrite` 为 `invalid`，不得 clamp 为零；
- normalized projection 可按 parser version 重建；raw observation 不修改、不复制。

### Counter handling

- `delta`：source dedupe 后直接属于 scope；
- `cumulative`：必须与相同 collection/session/model/field segment 的 baseline 求差；counter 下降开启 reset
  segment，不能产生负 delta；
- `gauge`：只表达观测时状态，不加入范围 Token/Cost sum；
- resume 无可靠 baseline：保留 cumulative/gauge，当前 Run delta 为 `null`；
- ACP `usage_update.used/size` 是 Context Gauge；可选 cost 默认是 cumulative Session Cost；
- prompt terminal `result.usage` 与 `usage_update` 是不同边界，不能因为字段同名就相加。

### Cost representation

```ts
type MonitoringCostQuality =
  | 'runtime_reported'
  | 'runtime_estimate'
  | 'price_estimated'
  | 'provider_reconciled'
  | 'allocated'
  | 'tokenizer_price_estimated'

interface RuntimeUsageCost {
  amount: string // 非负规范 decimal，不允许 exponent notation
  currency: string // ISO 4217 uppercase，或 Provider 明确返回的受控代码
  quality: MonitoringCostQuality
  grain: 'model_call' | 'turn' | 'run' | 'session' | 'billing_bucket'
  pricingCatalogVersion: string | null
}
```

持久层必须无损保存规范 decimal，不能用 IEEE-754，也不能把低于一分的调用成本舍入为 0。

## Native Session fact

```ts
type NativeSessionResumeDisposition = 'new' | 'compatible' | 'controlled'
type NativeSessionResumeOutcome =
  | 'not_attempted'
  | 'succeeded'
  | 'rejected'
  | 'incompatible'
  | 'ambiguous'
  | 'failed'

interface AgentRunNativeSessionFact {
  collectionEpoch: string
  agentRunId: string
  executionEpoch: number
  resumeRequested: boolean
  resumeDisposition: NativeSessionResumeDisposition
  resumeOutcome: NativeSessionResumeOutcome
  fallbackToNewSession: boolean
  reasonCode: string | null
  decidedAt: string
  resolvedAt: string | null
}
```

约束：

- `resumeRequested = false` 必须是 `new + not_attempted + fallback=false`；
- `succeeded` 不得 fallback；
- `rejected/incompatible/ambiguous/failed` 可以 fallback，但 fallback 只有实际创建新 Session 后为 true；
- `controlled` 的最终结果必须从 `not_attempted` 进入一个 terminal outcome；
- 一条 fact 只属于同一 enrolled Run/epoch；旧 attempt/history 不进入该 fact。

产品“Session 延续”分子只包括实际 `succeeded`；eligible 分母为 cutover 后本应决定 new/resume 的 terminal
enrolled Run。New、fallback 和未知/未终结分别显示，不从 Conversation ID 推断。

## Common query types

### Request

```ts
type MonitoringRange = '24h' | '7d' | '30d'

interface MonitoringFilter {
  range: MonitoringRange
  adapterKind?: AdapterKind
  agentId?: string
  terminalStatus?: 'succeeded' | 'failed' | 'cancelled'
}
```

不存在 Camp filter。`agentId` 必须解析为当前或历史 retained AgentProfile；不存在则返回 closed error。
`terminalStatus` 只过滤 terminal 行，不能把 active Run 解释成某个终态。

### Metric envelope

```ts
type MonitoringAvailability = 'available' | 'partial' | 'unavailable'

type MonitoringMetricSource =
  | 'core_fact'
  | 'runtime_native'
  | 'normalized_runtime'
  | 'local_tokenizer'
  | 'price_catalog'
  | 'provider_billing'
  | 'mixed'

type MonitoringMetricQuality =
  | 'authoritative_core'
  | 'runtime_reported'
  | 'normalized'
  | 'tokenizer_estimated'
  | 'runtime_estimate'
  | 'price_estimated'
  | 'provider_reconciled'
  | 'allocated'

interface MonitoringMetric<T = number> {
  availability: MonitoringAvailability
  value: T | null
  numerator: number | null
  denominator: number | null
  observedCount: number
  eligibleCount: number
  coverage: number | null // 0..1；eligibleCount=0 时必须为 null
  source: MonitoringMetricSource
  quality: MonitoringMetricQuality[]
  latestObservedAt: string | null
  diagnosticCode: string | null
}

interface MonitoringMoneyValue {
  amount: string
  currency: string
  quality: MonitoringCostQuality
  grain: RuntimeUsageCost['grain']
  pricingCatalogVersion: string | null
  reconciledThrough: string | null
}
```

不变量：

- `observedCount <= eligibleCount`；
- `eligibleCount > 0` 时 `coverage = observedCount / eligibleCount`；
- `available` 要求值可计算且 `coverage = 1`；
- `partial` 要求值基于非空 observed subset 且 `0 < coverage < 1`，或存在明确的 mixed quality；
- `unavailable` 要求 `value = null`；无 eligible 和有 eligible/零 observed 用 diagnostic 区分；
- 聚合 `0` 只在至少一个 observed fact 明确支持时成立；
- `quality` 是有序去重集合，不用一个最佳标签覆盖底层来源。

## Methods

三个方法都在一个 SQLite read transaction 中捕获 collection boundary 和数据。响应 `schemaVersion = 1`。

### `monitoring.summary`

```ts
interface MonitoringSummaryView {
  schemaVersion: 1
  collection: MonitoringCollectionBoundary
  filter: MonitoringFilter
  runs: MonitoringMetric<number>
  activeRuns: MonitoringMetric<number>
  successRate: MonitoringMetric<number>
  endToEndP95Millis: MonitoringMetric<number>
  nativeSessionContinuationRate: MonitoringMetric<number>
  cacheReadTokenShare: MonitoringMetric<number>
  bestAvailableCost: MonitoringMetric<MonitoringMoneyValue[]>
  trend: MonitoringTrendBucket[]
  terminalDistribution: MonitoringTerminalDistribution
  byRuntime: MonitoringRuntimeSummaryRow[]
  attention: MonitoringAttentionSummary
}
```

`bestAvailableCost` 可以因币种/粒度返回多项，不能隐式 FX 汇总。Runtime row 不拥有精确模型 Usage 时，
model-related value 为 partial/unavailable。

### `monitoring.usage`

```ts
interface MonitoringUsageView {
  schemaVersion: 1
  collection: MonitoringCollectionBoundary
  filter: MonitoringFilter
  inputTokens: MonitoringMetric<number>
  outputTokens: MonitoringMetric<number>
  reasoningOutputTokens: MonitoringMetric<number>
  cacheReadInputTokens: MonitoringMetric<number>
  cacheWriteInputTokens: MonitoringMetric<number>
  cacheReadTokenShare: MonitoringMetric<number>
  requestCacheHitRate: MonitoringMetric<number>
  cacheReadWriteAmortization: MonitoringMetric<number>
  contextUsageRate: MonitoringMetric<number>
  cacheSavingsEstimate: MonitoringMetric<MonitoringMoneyValue[]>
  costLayers: MonitoringCostLayerView[]
  byRuntimeAndModel: MonitoringUsageBreakdownRow[]
}
```

`inputTokens` 是已证明互斥桶的 `uncached + read + write`。只有 raw cache-inclusive total、但 Cache Write
未知时，原始值可以在 breakdown 的 diagnostic 中存在，不能进入规范 Input 或 Cache share。

`requestCacheHitRate` 只使用具有稳定 `model_call` boundary 且 Cache 字段可判定的调用。Run/Turn/Session
聚合值不充当调用数。

### `monitoring.reliability`

```ts
interface MonitoringReliabilityView {
  schemaVersion: 1
  collection: MonitoringCollectionBoundary
  filter: MonitoringFilter
  queueP95Millis: MonitoringMetric<number>
  inputAcceptanceP95Millis: MonitoringMetric<number>
  firstVisibleActivityP95Millis: MonitoringMetric<number>
  executionP95Millis: MonitoringMetric<number>
  endToEndP95Millis: MonitoringMetric<number>
  session: MonitoringNativeSessionSummary
  context: MonitoringContextSummary
  approval: MonitoringApprovalSummary
  toolDuration: MonitoringToolDurationSummary
  activity: MonitoringActivityCoverageSummary
  compaction: MonitoringCompactionSummary
  runtimeHealth: MonitoringRuntimeHealthRow[]
  attention: MonitoringAttentionSummary
}
```

## Metric formulas

| Metric | Formula / eligibility |
| --- | --- |
| Success rate | `succeeded / (succeeded + failed + cancelled)`；只含 enrolled reliable terminal |
| Queue | `startedAt - createdAt` |
| Execution | `endedAt - startedAt` |
| End-to-end | `endedAt - createdAt` |
| Input acceptance | `delivery.acceptedAt - delivery.preparedAt`；accepted only |
| First visible activity | `first Evidence occurredAt - delivery.acceptedAt`；两端都存在，不称首 Token |
| Session continuation | `resumeOutcome=succeeded / eligible terminal Session facts` |
| Cache Read Token share | `read / (uncached + read + write)`；互斥桶已知 |
| Request cache hit | `model calls with read>0 / cache-observable model calls` |
| Read/write amortization | `sum(read) / sum(write)`；write unknown 时 unavailable；write=0/read>0 返回 diagnostic 而非 Infinity |
| Context usage | `contextUsed / contextWindow`；同一 gauge，window>0 |
| Approval wait | terminal `resolvedAt-requestedAt`；pending `observedAt-requestedAt`，分别汇总 |
| Tool paired elapsed | 每个严格配对 operation 的 `terminalAt-startedAt` 之和 |
| Tool wall-clock union | 同一 Run 内严格配对 Tool interval 的区间并集，再跨 Run 求和 |
| Compaction coverage | observed/eligible observer-capable enrolled Run；unsupported 不进入 eligible |

负 duration、倒退时间、分母为零、非法 counter 或不兼容币种不 clamp、不猜测；对应 metric 降为 partial/
unavailable 并返回 stable diagnostic。

## Tool Duration contract

```ts
interface MonitoringToolDurationSummary {
  eligibleCalls: number
  pairedCalls: number
  coverage: number | null
  pairedElapsedMillis: number | null
  wallClockUnionMillis: number | null
  unpairedStartedCalls: number
  terminalOnlyCalls: number
  conflictingCalls: number
}
```

严格配对键是 `(agentRunId, executionEpoch, operationId)`。只接受 Core-owned operation 或 Canonical Runtime
Activity 中经结构化证据验证的 stable identity。不得按 title、command、cwd、timestamp window、final output
或 workspace diff 配对。重复同 terminal 幂等；冲突 terminal 进入 `conflictingCalls`，不贡献 duration。

## Cost layers and best available

```ts
interface MonitoringCostLayerView {
  quality: MonitoringCostQuality
  grain: RuntimeUsageCost['grain']
  values: MonitoringMoneyValue[]
  observedCount: number
  eligibleCount: number
  coverage: number | null
}
```

同一 query 可以同时返回多层。`best available` 只在以下键完全相等的候选内选择：

```text
currency + grain + effective time range + adapter/model/project/api-key dimensions
```

候选优先级为 `provider_reconciled > runtime_reported > runtime_estimate > price_estimated >
tokenizer_price_estimated`。`allocated` 永远保持 allocated，不自动覆盖一个精确 Run value。无 request linkage
或隔离维度的 billing bucket 只在 aggregate grain 展示。

## Antigravity estimate boundary

Antigravity v1 native support snapshot 的 Token/Cache/Context/Cost 全为 false。本地 Tokenizer 若启用：

- 只读取 Rovai 已知的已物化输入 payload 和 Adapter Final Boundary 验证的最终输出；
- 保存 tokenizer name/version 与 `source=local_tokenizer`；
- quality 固定 `tokenizer_estimated`；
- Cache、Context Window、Provider actual Token 和 runtime/provider cost 仍为 `null`；
- public-price 金额为 `tokenizer_price_estimated`，同时保留 tokenizer 和 price catalog version；
- 不进入 `nativeFields` observed/eligible 计算。

## Rollup

小时级 rollup 只能存 additive total/count、min/max、eligible/observed 和可合并 distribution sketch。它必须
携带 collection epoch、filter dimensions、projection/parser/catalog version 与 freshness。P50/P95 不得存成
随后再平均的最终百分位。Rollup 删除后可由当前 epoch Enrollment、Core fact 与 normalized observation 重建。

## Errors and privacy

Closed errors 至少包括：

```text
monitoring.invalid_filter
monitoring.unknown_agent
monitoring.collection_unavailable
monitoring.schema_mismatch
monitoring.query_failed
monitoring.export_failed
```

单个 Runtime/parser/field 不支持不是 method error，而是 unavailable metric。Query error 不返回部分拼装的
无 schema payload。

普通响应和导出不得包含 Prompt、Completion、Memory、附件、Tool Output、absolute path、credential、裸或
digest Native ID、request ID、thread ID、session ID。脱敏导出包含 collection boundary、filter、聚合 metric、
Coverage、source/quality、受控 Runtime/model label 和 diagnostic code；保存与 reveal 继续服从 Desktop 显式
用户动作和 exact-path session 边界。

## References

- [ADR-0201](../adr/0201-sparse-runtime-usage-and-clean-break-monitoring.md)
- [Runtime Monitoring architecture](../architecture/runtime-monitoring.md)
- [v0.96 implementation plan](../versions/v0.96/implementation-plan.md)
- [Runtime monitoring feasibility audit](../research/runtime-monitoring/README.md)
- [ADR-0013](../adr/0013-managed-content-and-read-side-v2.md)
- [ADR-0111](../adr/0111-core-owned-canonical-runtime-activity.md)
- [ADR-0112](../adr/0112-immutable-execution-evidence-and-rebuildable-canonical-activity-projection.md)
- [ADR-0117](../adr/0117-observation-capability-coverage-levels-across-runtime-adapters.md)
- [ADR-0148](../adr/0148-read-only-diagnostics-and-data-minimized-export.md)
