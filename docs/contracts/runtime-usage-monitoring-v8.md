---
document_type: contract
contract: runtime-usage-monitoring
version: 8
status: accepted
source_version: v1.72
last_updated: 2026-10-03
---

# Runtime Usage Monitoring v8

v8 继承 [v7](runtime-usage-monitoring-v7.md) 的原生来源、稀疏值与归属，修正归一化与 Flush 的顺序。
本版没有数据库迁移、正文持久化或 Runtime 版本准入变化。内部 `parser_version` 升至 5。

## 独立调用与批次无关

每个已去重的原生 Usage observation 在进入 buffer 时完成校验和归一化；缓存请求分子、分母也在该
调用边界生成。buffer 按来源分组、保留有序的数值记录；不先相加各调用的 raw input/read/write 再归一化。
缺少互斥分类的调用，其 Input total 仍未知；另一调用的已知分类不能补齐它。已归一的非空值可加入
Run summary 与 hourly 的已观测部分和。显式零继续可计；未知不会变成零。

单次模型调用且 Cache Read 明确上报时，observable request 加 1，read > 0 时 hit 加 1，否则 hit 加 0。
只有 Cache Write 无法证明命中或未命中；聚合 Turn/Session 无法证明请求数。Codex 的 native `last`
属于 `model_call`；Grok/ZCode 的聚合 Turn 不构造请求命中计数。不同调用即使 token 数相同也分别计数。

累计来源保留同一来源的完整数值顺序，包括首个 baseline 和 reset；首值、正差和 Claude 新调用的零
基线规则继承前版。Gauge 不跨帧拼接 used/window。周期 Flush 仍最多每 4 秒一次，以短事务同步
checkpoint、summary 和 hourly；失败恢复时旧记录排在新到记录之前。每条记录沿用自己的观测时刻。
同一组有序输入在任意 Flush 分区、重复投递及事务回滚后，其数值与完整性必须一致。

Delta checkpoint 加入单个 source identity 的摘要，按调用去重，而不是按某次批次的 identity 集合去重。
已提交 delta 批次重试不会重复加和。checkpoint 仍是活动 Run 的暂存数值状态，terminal 删除、遗留
72 小时清理；不新增永久去重日志、原始或归一 observation 表。累计流的已提交历史重放仍须由
既有执行代次与 source identity 边界排除，不能把旧流当作新的 counter reset。

## Input / Output 的部分状态

复用 summary 的 `usage_quality`：收到 token contribution 但该调用的归一 Input 或 Output 不完整时，
写入 `runtime_reported_partial`。累计差分还要求先前 baseline 两项可得。该状态对逻辑 Run 是粘性的，
不会被后续完整调用、终态或另一次 Flush 清除。只有 Cost/Context 的观察不改变这一状态。
已知 Input/Output 而 Cache Write 等可选分类未知，不因此否定 Input＋Output 的范围。

该状态描述已收到的 Input/Output contribution，不保证 Runtime 没有漏发调用，不代表四项缓存字段
均有完整覆盖。Coverage 仍是 observed logical Runs / eligible logical Runs，不改成完整率。
过去 collector 版本未保留这项证据，读侧保持完整性未知，不重算或改写其历史数值。
执行台的完整性投影见 [Execution Metrics v5](runtime-execution-metrics-v5.md)。

回归与限制见[分批刷盘一致性验收](../research/runtime-monitoring/flush-partition-verification-2026-10-03.md)。
