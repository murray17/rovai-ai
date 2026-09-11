---
document_type: interface-contract
contract: execution-evaluation
version: 14
authority: context-regression-and-daily-trace-evaluation
status: accepted
source_version: v1.58
last_updated: 2026-09-11
---

# Execution Evaluation v14

v14 继承 [v13](execution-evaluation-v13.md)，仅扩展主动回归的评分执行故障分类，配合 [Semantic Judge Views v11](semantic-judge-views-v11.md)。每日统计、产品上下文、数据库与普通 CLI 帮助不变。

报告新增 `evaluationFailures[]`：记录 Case、repeat、arm、`judge_execution_failed` 以及失败 view/replica、原因、尝试数和保留定位；无法取得副本记录时保留进程失败。只根据 suite 绑定并验证摘要的不可用副本或实际评分进程失败产生该字段，不从低分推导。有效副本继续保留。

`conclusions.evaluation` 新增 `execution_failed`；`evaluatorFailureTrials` 按 Case × repetition 去重。`failedTrials` 仍表示验收失败；`evidenceGapTrials` 保留采集缺失、分歧和其他未知。只从 evidenceGaps 移走可确认为评测器未完成引起的缺项，不隐藏同 Trial 的真实失败、另一 View 或另一 arm 的证据问题。

这些故障使验收未完成，不能自动放行，也不能作为 Agent 零分。只有评价完整才能发布总分；可观测产物缺失、关键目标失败和不实声明仍按规则或语义判定扣分。报告同时存在实际失败与评分故障时，两类同时展示。

新计划默认每 Case 评分预算 2400 秒，可冻结为 240–2400 秒；单次请求与整个 Case 预算分别约束。复核仍受总 campaign 预算限制，预算不足明确不运行。旧计划与历史报告字段兼容，不推断历史评分故障为零。

原文引用或审计字段违反协议时，未形成有效结论的项记录为 `claim_audit.invalid_output`，列入 evaluationFailures，不冒充任务来源缺失。有效复核已解决的原始错误继续留在副本中，不再次阻断最终判定。
