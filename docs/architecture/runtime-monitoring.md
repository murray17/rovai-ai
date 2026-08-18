---
document_type: architecture
architecture: runtime-monitoring
authority: runtime-usage-metering-and-read-boundaries
status: accepted
last_updated: 2026-08-17
---

# Runtime Monitoring 架构

精确字段与方法见 [Runtime Usage Monitoring v3](../contracts/runtime-usage-monitoring-v3.md)。长期最小化、
稀疏语义、clean break 与 Cost grain 由
[Evidence 与 Usage 不变量](foundational-invariants.md#evidence-usage)拥有。本架构只说明 Usage Transport、内存归一化、
Projection/Rollup、Read Side 和 Renderer 如何组合。

## Component authority

| Component | Responsibility |
| --- | --- |
| Runtime adapter parser | 从已证明的 Runtime/version wire path 提取稀疏 Token/Cache/Cost；不估算缺失值 |
| Usage buffer | 以内存 source identity 去重，合并兼容 update，保持 cumulative/gauge baseline |
| Usage flush service | 周期最多每 4 秒一次；一个短事务更新 checkpoint、Run summary 与 hourly rollup |
| Pricing catalog | 按 model key、service tier 与 effective date 提供版本化公开费率；不访问网络 |
| AgentRun terminal boundary | 在结算前等待该 Run pending Usage Flush；权威状态 transition finalizes summary 并删除 checkpoint |
| Retention worker | 每天低频、分批删除超过 45 天的 derived rows 与超过 72 小时的 abandoned checkpoint |
| Snapshot read side | 一次短查询组装 summary/trend/breakdown/Coverage；不访问 Evidence、Blob、Transcript 或网络 |
| Provider reconciliation writer | 在独立后台任务中保存 aggregate billing bucket；不由页面刷新触发 |
| Renderer | 一个 Usage 页面，single-flight Snapshot、可见时有界刷新、未知值与 Coverage 并列展示 |

Execution Evidence、Canonical Activity、AgentRun、Approval、Delivery、Recovery、Context 和 Runtime health
继续由各自 Core domain 拥有。Monitoring 不复制、不删除也不重建这些事实。

## Write path

```text
Runtime event/result
  -> adapter/version parser
  -> sparse normalized Usage in memory
  -> source-identity dedupe + compatible merge
  -> 4s periodic flush OR terminal forced flush
  -> one short SQLite transaction
       runtime_usage_checkpoint
       runtime_usage_run_summary
       runtime_usage_hourly
       optional Codex price_estimated projection
```

`delta` 可直接进入 additive projection；`cumulative` 与 `gauge` 的首值只建立 baseline，之后只投影正差。
counter reset 只重建 baseline。Run summary 以 logical `agent_run_id` 为粒度，Recovery execution epoch 只隔离
checkpoint，避免重复 Run 和 Coverage。Runtime 事件处理不写 raw/normalized observation row，也不追加
Execution Evidence。

OpenCode `>= 1.18.15` 的官方 dialect 把可选 thought/cache bucket 的省略定义为零；parser 只在完整成功
terminal Usage 上应用该版本感知规则。OpenCode ACP `usage_update.cost` 是累计 Session gauge，不进入 Run
summary。Codex `>= 0.145.0` 的四个完整 Token bucket 可在同一 Flush 事务中命中静态价格目录，覆盖当前
Run 的 API public-price equivalent；不新增长期事件表，也不在页面读取时计算。

周期 Flush 不发出立即 Snapshot 事件。普通事件受全局最短间隔约束；terminal 事件可在 Debounce 后立即
刷新。所有请求仍 single-flight，从而不让 Dashboard 反向阻塞单一 SQLite Database Mutex 上的运行结算。

## Read path

```text
visible Settings page
  -> one monitoring.snapshot(filter)
  -> bounded SQL over run_summary/hourly/reconciliation
  -> RuntimeUsageSnapshot v2
  -> summary + trend + Runtime/Model tables + optional reconciliation
```

24 小时趋势直接读取 hourly；7/30 天在查询中按日聚合。Snapshot 不随 Tab 预计算无关 read model，因为
当前页面没有 Tab 和 Reliability 子产品。查询只处理小 projection，不读取 Managed Blob、不解析大型 JSON、
不扫描 Transcript/Evidence，也不执行网络请求。

## Sparse and grain rules

- missing 保持 `NULL`；显式 zero 或已验证 dialect 的 omitted-zero 才参与聚合；
- Runtime/version Eligibility 由真实 Fixture/协议冻结，不因某次 Run 缺字段而改变；
- Coverage 始终按 `observed logical Runs / eligible logical Runs`；
- input/cache bucket 只有在 semantics 可证明时组合；
- reasoning output 不与 output 重复相加；
- Run cost 只保存可归因该 Run 的最佳来源；Codex catalog projection 固定为
  `price_estimated / price_catalog / USD`，不是订阅账单；
- Provider aggregate cost 保持 Provider/billing scope/currency/time range grain，不分摊到 Run；
- currency 不推断、不转换，不同 currency 分行返回。

## Retention and clean break

Run summary、hourly 与 reconciliation 保存 45 天。active checkpoint 受保护；terminal transition 立即删除，
遗留 checkpoint 72 小时到期。清理每天一次、每批不超过 1,000 行，不在页面请求中执行，也不自动完整
`VACUUM`。

Migration 92 是破坏性的 Monitoring clean break：删除 v1 Monitoring schema，建立 schema 2 五表、新 collection
epoch、Database contract `v0.99` 与 projection schema `47`。不存在回填、双读、双写或兼容视图。

## References

- [Evidence 与 Usage 不变量](foundational-invariants.md#evidence-usage)
- [Runtime Usage Monitoring v3](../contracts/runtime-usage-monitoring-v3.md)
- [v0.99 implementation plan](../versions/v0.99/implementation-plan.md)
- [Runtime monitoring feasibility audit](../research/runtime-monitoring/README.md)
- [Core 受管内容不变量](foundational-invariants.md#core-managed-content)
- [Canonical Activity 不变量](foundational-invariants.md#evidence-canonical-activity)
