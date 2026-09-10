---
document_type: interface-contract
contract: execution-evaluation
version: 5
authority: context-regression-and-daily-trace-evaluation
status: accepted
source_version: v1.57
last_updated: 2026-09-10
---

# Execution Evaluation v5

v5 继承 [v4](execution-evaluation-v4.md) 的隔离、预算、并行、模型身份和历史保留约束，采用 Suite 2.3.0 / scoring 2.1.0 及 [Semantic Judge Views v3](semantic-judge-views-v3.md)。任务、时间预算、硬性验收、50/25/25 权重、协作分项与未知分母不变。

## 三个独立结论

报告保留旧 `status` 供既有调用方处理，新增 `conclusions`：

- `acceptance`：passed / failed / incomplete，是否满足本轮验收；已知失败与证据缺口可并存。
- `regression`：not_compared / detected / inconclusive / not_detected。每周单版本运行必须为 not_compared；不能把验收失败称为新退化。仅有效基线对照可判断新退化。
- `evaluation`：complete / incomplete，证据和评价是否齐全；不是任务成功率。

分别按 Case × repetition 去重保存失败、证据缺口和新退化 Trial 数，同时保留每条问题记录。一项失败可导致多条检查记录，不能因此扩大失败 Case 数；失败与未知 Trial 允许重叠。缺少必需评价时不发布完整质量总分，也不将已知项平均冒充整套分数。

## 可读报告

HTML 与 Markdown 从同一 JSON 呈现结论、任务标题、硬性验收、Judge 状态、逐 Case 质量和覆盖、实际耗时、问题原因与证据链接。逐项保留两个 Judge 的理由与引用。旧报告未提供三类结论时明确标为旧口径，不倒推新退化。

报告和计划保留实际源码、二进制、方案、Suite、评分、rubric、Judge 及执行配置版本。新 rubric 不覆盖旧报告；不同口径不能直接连接趋势。评测器故障、Agent 失败与运行环境受阻分开解释。完整交付报告允许有明确标注的未知，不意味着补造总分或放行。

## 边界

新增数据限显式启动的隔离评测产物，不新增普通用户数据库字段或日常采集。每日 Trace 口径与报告不变。固定回归与独立验收保留集分开；本轮未运行保留集就明确记为未运行。
