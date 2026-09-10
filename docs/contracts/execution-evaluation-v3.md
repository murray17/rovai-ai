---
document_type: interface-contract
contract: execution-evaluation
version: 3
authority: context-regression-and-daily-trace-evaluation
status: accepted
source_version: v1.57
last_updated: 2026-09-10
---

# Execution Evaluation v3

v3 继承 [v2](execution-evaluation-v2.md) 的评分、Case 适用性、未知分母、硬性 Gate、预算、双轨报告及历史保留规则。仅更新当前 Core 协作证据的版本适配；产品上下文、评分权重、数据库与每日指标不变。

## 当前协作账本

新生成账本使用 `rovai.qualification.collaboration-ledger@1.1.0`，其 [schema](schemas/collaboration-ledger-v1.1.schema.json) 与摘要进入跨版本 catalog。已有 1.0.0 账本继续按历史 schema 读取，不能原地改写为新格式。

当前 Public A2A 的 `edgeKind` 来自既有 Message Delivery：forward、return 或明确未知。深度是目标执行的 lineage depth；返回原 Lead 时可合法为 0。只有已确认的 return 允许深度 0，forward 或未知的零深度不产生完整 canonical Call。旧 forward-only 来源按其既有合同映射为 forward。

接纳次数包含 Core 预算已计入的 forward 与 return，仍必须与完整 receipt、Message Delivery、正文证据引用及目标 Run 对齐。不能以适配修正为由忽略缺失证据或放宽 Case 上下限。正常 return 不作为 forward_cycle 的边；重复路径与重复接纳事实仍保留，是否必要由对应语义评价判断。

仅有历史元数据而缺少 event payload 时不猜测。若使用保留的 Core 记录补充 payload，需核对原观察的 payload digest，记录新增来源及重算版本。重放只修正证据解释，不表示重新执行了模型任务；不得覆盖原回归报告或把已知预算／产物失败改成通过。

## 宿主执行边界

`rovai app eval` 按 [User Automation v4](user-automation-v4.md) 由 owner 注册并交给 App 宿主执行，受管 Agent 读取当前运行的报告。运输完成、评测进程完成与 Gate 放行分别判断。定时任务一次性计划的自动消费不等于用户主动关闭；关闭的版本变化仍阻止派发并终止宿主拥有的运行。

公开 Case 要求与 verifier 不一致时，须独立修订、重新准入、更新 Suite 并保留旧目录。缺少真实 Judge、未运行计划项或环境证据不足仍不得放行；定向补验与原周回归分开列示。
