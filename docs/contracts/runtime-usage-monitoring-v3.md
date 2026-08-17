---
document_type: contract
contract: runtime-usage-monitoring
version: 3
status: accepted
last_updated: 2026-08-17
---

# Runtime Usage Monitoring v3

本合同定义 `monitoring.snapshot`、Runtime Usage 解析、五表持久化和 Renderer 的当前长期边界。设计理由见
[ADR-0205](../adr/0205-minimal-runtime-usage-metering.md)，组件组合见
[Runtime Monitoring 架构](../architecture/runtime-monitoring.md)。v1、v2 是历史合同；v3 不改变持久表或
Snapshot wire shape，只收紧 OpenCode Token/Cache 语义并增加 Codex public-price projection。

## 产品范围

Monitoring 汇总 Runtime 明确上报的 Token/Cache、可归因 Run 的 Runtime Cost，以及从完整 Token bucket、
冻结模型和版本化公开价目录计算的估算 Cost。缺失字段通常为 `NULL`；只有已验证 dialect 明确定义“省略即
零”时才能归一为显式零。不得从文本、Transcript、Execution Evidence 或本地 Tokenizer 补造权威值。
Session、Tool、Activity、Delivery、Approval、Reliability、Context、Compaction 和 Probe 不属于本合同。

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
`reasoningOutputTokens` 是 `outputTokens` 子集。Cost 必须同时有合法 amount 和 currency；不得默认币种、跨
币种求和或把 Provider billing bucket 分摊到 Run。

同一 source identity 在内存去重并合并。delta 直接累加；cumulative/gauge 的首个值只建立 checkpoint，
之后只写正向差值，回退视为 counter reset 并重建 baseline。周期 Flush 最多每 4 秒一次；AgentRun terminal
边界强制 Flush，权威 terminal transition 完成 summary 并删除 checkpoint。

当前由 Runtime 版本、上游合同 Fixture 与真实探针共同冻结的 ACP Usage 边界为：

| Runtime/version | 已证明路径 | Eligible 字段 | 保持未知 |
| --- | --- | --- | --- |
| OpenCode `>= 1.18.15` | terminal `result.usage` | prompt input total、uncached input、cache read、cache write、output、reasoning、request cache hit | Run cost |
| CodeBuddy `>= 2.133.1` | `usage_update._meta.usage` | prompt input total、uncached input、cache read、output、reasoning、request cache hit | cache write |
| Qwen Code `>= 0.21.5` | `agent_message_chunk._meta.usage` | prompt input total、cache read、output、reasoning、request cache hit | uncached input、cache write |

CodeBuddy 同一 model call 可能补发带分类信息的相同 Usage；以稳定 request ID 去重，不能重复累计。

OpenCode `buildUsage()` 把 `inputTokens` 定义为 non-cached Input，只在大于零时输出 `thoughtTokens`、
`cachedReadTokens` 与 `cachedWriteTokens`。因此对 `>= 1.18.15` 的成功 terminal Usage：

```text
uncached_input = inputTokens
cache_read = cachedReadTokens ?? 0
cache_write = cachedWriteTokens ?? 0
reasoning = thoughtTokens ?? 0
output_total = outputTokens + reasoning
prompt_input_total = uncached_input + cache_read + cache_write
```

该省略归零仅在核心 `inputTokens` 与 `outputTokens` 都合法时启用；字段存在但类型非法或越界时保持未知，
不能伪装成省略。OpenCode `usage_update.cost` 是 `totalSessionCost(messages)` 的累计 Session gauge，不是当前
Turn/Run cost；v3 不保存或差分它，也不因此声明 Run cost Eligibility。未来如要使用，必须先建立 Native
Session-scoped 短期 baseline，并另行升级合同。

版本未知或低于已验证版本时，不扩大私有字段 Eligibility；Runtime 实际没有提供的字段继续为 `NULL`。

## Codex public-price projection

Codex App Server 不提供单 Run 货币成本。对 Codex CLI `>= 0.145.0`，只有以下条件同时成立时才生成 Run
estimate：

- `inputTokens`、`cachedInputTokens`、`cacheWriteInputTokens`、`outputTokens` 四桶完整；
- `uncachedInput = inputTokens - cachedInputTokens - cacheWriteInputTokens` 非负；
- `modelKey`、可辨识 service tier、Run enrollment date 能命中版本化价格目录。

Reasoning 是 Output 子集，不额外计费。持久结果固定为：

```text
cost_kind = price_estimated
cost_source = price_catalog
currency = USD
pricing_catalog_version = <model + tier + effective-date revision>
```

该金额是 OpenAI API public-price equivalent，不是 ChatGPT/Codex 订阅实际账单，也不是 Provider
reconciliation。目录分别保存 Uncached Input、Cached Input、Cache Write 与 Output 费率；GPT-5.6 的 Cache
Write 使用对应模型 uncached Input 的 `1.25x`，更早模型不能套用该规则。无法确认模型/费率、旧 Codex 缺
Cache Write bucket、未知 service tier 时不生成值。当前 projection 不声称覆盖 long-context multiplier、
regional uplift、Tool call fee 或 Codex Credits；因此始终标为 estimated。

## Eligibility 与 Coverage

Runtime/version 在 enrollment 时冻结 `eligibleMask`。仅协议合同或受审计 Fixture 已证明的字段可置位；
Codex Cost 还要求当时的 model/tier/date 能命中价格目录。Coverage 对每个字段返回：

```ts
interface RuntimeUsageCoverageValue {
  eligibleRuns: number
  observedRuns: number
}
```

`observedRuns` 按 logical AgentRun 去重，且不得超过 `eligibleRuns`。不支持与未上报均显示未知，但 Coverage
明确两者的统计边界。

## 持久化合同

当前 Usage schema version 仍为 `2`，只有以下五张 Monitoring domain table：

| Table | Key | Authority |
| --- | --- | --- |
| `runtime_usage_collection_state` | singleton `1` | 当前 clean-break epoch、schema version、开始时间 |
| `runtime_usage_run_summary` | `(collection_epoch, agent_run_id)` | logical AgentRun 的稀疏累计值、冻结维度、Eligibility、最佳可归因 Run cost 和 finalization |
| `runtime_usage_hourly` | epoch/hour/runtime/provider/model 唯一维度 | 可加和 Token/Cache/request counters 的小时 rollup |
| `runtime_cost_reconciliation_bucket` | epoch/provider/billing-scope/currency/range | Provider aggregate reconciliation，不做单 Run 归因 |
| `runtime_usage_checkpoint` | epoch/run/execution epoch/checkpoint key | active cumulative baseline、source digest、reset/restart state |

不得持久化 raw Usage、normalized observation history 或 permanent dedupe ledger；Usage 不得写为 Execution
Evidence。Recovery epoch 共用 logical Run summary，但 checkpoint 必须按 execution epoch 隔离。价格目录是
版本化代码数据，不新增长期事件表；Run summary 只保存最终/当前累计 estimate 与 catalog version。

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

响应 `schemaVersion` 仍固定为 `2`，包含：

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

页面仅显示汇总卡、Token/Cache 趋势、Runtime/Model 表，以及数据存在时的 Cost/Provider 对账。未知值显示
`—` 并附 Coverage；页面打开或普通刷新不得启动 Provider reconciliation、价格同步、retention 或任何
网络工作。价格目录只随发布版本更新，Snapshot 不访问网络。

## Compatibility

v3 沿用 Migration 92 建立的 Usage schema 2 五表和 Snapshot schema 2；不迁移、不回填、不双写，也不
重置 collection epoch。v2 创建的 finalized rows 保持原样；新 Usage 只按 parser version 4 和 v3
Eligibility 解释。AgentRun、Execution Evidence、Approval、Context、Delivery、Recovery 与其他 Core 权威
事实完全不受影响。
