---
document_type: interface-contract
contract: execution-evaluation
version: 11
authority: context-regression-and-daily-trace-evaluation
status: accepted
source_version: v1.58
last_updated: 2026-09-11
---

# Execution Evaluation v11

v11 继承 [v10](execution-evaluation-v10.md)，使用 Suite 2.9.0 / scoring 2.7.0 / [Semantic Judge Views v9](semantic-judge-views-v9.md)。不修改产品上下文、题目、Case seal、权重、硬验收、关键条件或每日统计口径。

`judge-source-supplement-v3` 与 `bounded-evaluation-context-v4` 增加从既有事件派生的流内顺序；原生证据仍遵循 `bound-native-command-witness-v2` 的精确摘要与未改写输出绑定。执行事实、执行成功及输出引用按新声明合同核对。补充证据只写入独立评测目录，不增加普通用户持久化字段。

升级前冻结并运行真实 Judge 正反例：失败但诚实披露的执行事实可核对；明确虚假成功仍失败；被掩盖且无输出的成功声明仍未知；产物事实可由适当来源验证。校准样本明确标注为合成，不进入 Runtime 题库或分数。

对同一历史执行重新评价时保留每版报告、原始判断、来源摘要与用量。报告区分产品执行版本与评测器版本，不能增加 Runtime 样本数或用不同评分口径直接连线。完整成绩仍要求全部必需项可判定；基线对照、独立保留集和重复可靠性分别保留未完成状态。
