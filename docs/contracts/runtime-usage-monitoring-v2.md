---
document_type: contract
contract: runtime-usage-monitoring
version: 2
status: accepted
last_updated: 2026-08-17
---

# Runtime Usage Monitoring v2

本合同定义 `monitoring.snapshot`、Runtime Usage 解析、五表持久化和 Renderer 的当前长期边界。设计理由见
[ADR-0205](../versions/v0.99/decisions.md#adr-0205)，组件组合见
[Runtime Monitoring 架构](../architecture/runtime-monitoring.md)。v1 是历史合同，不再是兼容入口。

## 产品范围

Monitoring 只汇总 Runtime 或 Provider 明确上报的 Token、Cache 和 Cost。缺失字段为 `NULL`，显式零才是
零；不得从文本、Transcript、Execution Evidence 或本地 Tokenizer 补造权威值。Session、Tool、Activity、
Delivery、Approval、Reliability、Context、Compaction 和 Probe 不属于本合同。

## 解析与归一化

每个 Usage 输入至少包含 Runtime dialect、来源、scope、counter mode、input semantics、稳定 source
identity 以及稀疏值。counter mode 仅接受 `delta | cumulative | gauge`；input semantics 仅接受
`exclusive_buckets | cache_inclusive_total | unknown`。

归一字段为：

- `promptInputTotalTokens`
- `uncachedInputTokens`
- `cacheReadTokens`
- `cacheWriteTokens`
- `outputTokens`
- `reasoningOutputTokens`
- `requestCacheHitRate` 的 observed/hit request counters
- `cost { amount, currency, kind, source }`

只有来源证明 input 是否包含 cache bucket 时才计算 `promptInputTotalTokens` 或 `uncachedInputTokens`。
`reasoningOutputTokens` 是 `outputTokens` 子集。Cost 必须同时有合法 amount 和 currency；不得默认 USD、
跨币种求和或把 Provider bucket 分摊到 Run。

同一 source identity 在内存去重并合并。delta 直接累加；cumulative/gauge 的首个值只建立 checkpoint，
之后只写正向差值，回退视为 counter reset 并重建 baseline。周期 Flush 最多每 4 秒一次；AgentRun terminal
边界强制 Flush，权威 terminal transition 完成 summary 并删除 checkpoint。

当前由真实 Runtime Fixture 证明的 ACP 私有 Usage 边界为：

| Runtime/version | 已证明路径 | Eligible 字段 | 保持未知 |
| --- | --- | --- | --- |
| OpenCode `>= 1.18.15` | terminal `result.usage` | uncached input、cache read、output、reasoning、request cache hit | prompt input total、cache write |
| CodeBuddy `>= 2.133.1` | `usage_update._meta.usage` | prompt input total、uncached input、cache read、output、reasoning、request cache hit | cache write |
| Qwen Code `>= 0.21.5` | `agent_message_chunk._meta.usage` | prompt input total、cache read、output、reasoning、request cache hit | uncached input、cache write |

CodeBuddy 同一 model call 可能补发带分类信息的相同 Usage；以其稳定 request ID 去重，不能重复累计。
OpenCode 的 `thoughtTokens` 是 `outputTokens` 之外的桶，parser 先合成为包含 reasoning 的规范化 Output，
再保持 `reasoningOutputTokens` 为其中子集。版本未知或低于真实 Fixture 版本时，不扩大这些私有字段的
Eligibility；Runtime 实际没有提供的字段继续为 `NULL`。

## Eligibility 与 Coverage

Runtime/version 在 enrollment 时冻结 `eligibleMask`。仅协议合同或真实 Fixture 已证明的字段可置位。
Coverage 对每个字段返回：

```ts
interface RuntimeUsageCoverageValue {
  eligibleRuns: number
  observedRuns: number
}
```

`observedRuns` 按 logical AgentRun 去重，且不得超过 `eligibleRuns`。不支持与未上报均显示未知，但 Coverage
明确两者的统计边界。

## 持久化合同

当前 Usage schema version 为 `2`，只有以下五张 Monitoring domain table：

| Table | Key | Authority |
| --- | --- | --- |
| `runtime_usage_collection_state` | singleton `1` | 当前 clean-break epoch、schema version、开始时间 |
| `runtime_usage_run_summary` | `(collection_epoch, agent_run_id)` | logical AgentRun 的稀疏累计值、冻结维度、Eligibility、最佳可归因 Run cost 和 finalization |
| `runtime_usage_hourly` | epoch/hour/runtime/provider/model 唯一维度 | 可加和 Token/Cache/request counters 的小时 rollup |
| `runtime_cost_reconciliation_bucket` | epoch/provider/billing-scope/currency/range | Provider aggregate reconciliation，不做单 Run 归因 |
| `runtime_usage_checkpoint` | epoch/run/execution epoch/checkpoint key | active cumulative baseline、source digest、reset/restart state |

不得持久化 raw Usage、normalized observation history 或 permanent dedupe ledger；Usage 不得写为 Execution
Evidence。Recovery epoch 共用 logical Run summary，但 checkpoint 必须按 execution epoch 隔离。

Run summary、hourly 和 reconciliation bucket 保留 45 天。terminal checkpoint 立即删除；遗留 checkpoint
最多保留 72 小时。清理每天低频、每批最多 1,000 行，不由页面触发，不读取 Blob/Transcript，不执行
网络请求或自动完整 `VACUUM`。

## `monitoring.snapshot`

请求：

```ts
interface MonitoringFilter {
  range: '24h' | '7d' | '30d'
  runtimeKind?: AdapterKind
  providerKey?: string
  modelKey?: string
  costKind?: string
}
```

响应 `schemaVersion` 固定为 `2`，包含：

- `collection { epoch, startedAt }`
- `range { from, to }`
- `summary`：六类 Token/Cache、两个可选比率和可选 Cost summary
- `trend[]`：24h 为小时；7d/30d 从小时 rollup 在查询时按日聚合
- `byRuntime[]`、`byModel[]`：相同稀疏字段、Cost 与 Coverage
- `coverage`：八个稀疏指标的 observed/eligible Run 数

Cost summary 分开返回 `run[]` 与 `reconciliation[]`，并可按相同 currency 返回 `difference[]`。当过滤范围
无法与 Provider billing grain 对齐时，不返回 reconciliation。所有数值是原始数值，不返回 prompt、output、
Tool 内容、路径、credential、native ID 或 Runtime payload。

## Renderer 与刷新

设置页只有一个 Usage 页面和一个 `monitoring.snapshot` 请求。页面可见时最多每 12 秒轮询一次；隐藏或
离开设置项后停止。普通 Usage Flush 只更新 dirty revision，不触发立即 Snapshot；普通事件距上次成功
请求不足 10 秒时合并，AgentRun terminal 可在 300ms Debounce 后立即刷新。请求必须 single-flight。

页面仅显示汇总卡、Token/Cache 趋势、Runtime/Model 表，以及数据存在时的 Provider 对账。未知值显示
`—` 并附 Coverage；页面打开或普通刷新不得启动 Provider reconciliation、价格同步、retention 或任何
网络工作。

## Clean break

Migration 92 删除 Runtime Monitoring v1 的表、trigger 和索引，创建新五表及新 collection epoch。旧数据
不回填、不双写、不提供 compatibility view；AgentRun、Execution Evidence、Approval、Context、Delivery、
Recovery 与其他 Core 权威事实完全不受影响。
