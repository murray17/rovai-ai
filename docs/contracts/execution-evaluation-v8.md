---
document_type: interface-contract
contract: execution-evaluation
version: 8
authority: context-regression-and-daily-trace-evaluation
status: accepted
source_version: v1.57
last_updated: 2026-09-11
---

# Execution Evaluation v8

v8 继承 [v7](execution-evaluation-v7.md)，使用 Suite 2.6.0 / scoring 2.4.0 / [Semantic Judge Views v6](semantic-judge-views-v6.md)。任务质量 50/25/25、协作统计、关键项、未知分母和每日 Trace 口径不变。DEMO-106 新 Case 1.3.0 保持任务及预算，补充排序键与非空错误断言；旧 Case 和报告保留。

## 受控执行凭据

Runner 仅为已经选入有界验证回执的原始命令保存私有 `private-command-evidence.json`，校验源摘要，单条最多 50 KB、合计最多 200 KB。超限和遗漏显式记录，不静默截断成完整证据。该文件不进入 Judge 输入，不用于扩大 Outcome 权限，不是普通用户 Trace 的新增持久化要求。

每个新建隔离 Trial 在投递前、收集结束后读取既有 `monitoring.snapshot`，保存私有 `runtime-usage-before.json` 与 `runtime-usage-after.json`。只有 schema、collection epoch 一致、前置用量人口为空、后置 eligible/observed Run 数与 Trial Run 数匹配时，才把监控聚合归属该 Trial；否则未知。无需新增 Core 表、事件字段或 API。

Token 各字段独立携带覆盖数；输入和输出均完整时才计算 total。真实零值保留，缺字段为 null。Token 来源为 Runtime 经 Core 去重的上报，不等于费用账单。成本仅保留已有来源、币种及 reported/estimated 类型，估算不称实际成本，没有成本观测不填零。失败尝试的耗时与已观测消耗保留，不能只汇总成功样本。

完整必需质量评价不代表所有可选资源均可采集，单次运行也不证明可靠性。报告明确区分模型任务失败、评测器故障、采集缺失与环境受阻；新旧标准或模型参数不同不直接连接趋势。旧报告不覆盖，全部尝试与预算继续按冻结计划保留。
