---
document_type: interface-contract
contract: semantic-judge-views
version: 11
authority: semantic-judge-model-visible-evidence-and-reconciliation
status: accepted
source_version: v1.58
last_updated: 2026-09-11
---

# Semantic Judge Views v11

v11 继承 [v10](semantic-judge-views-v10.md)，新增 `generic-task-v11` / `claim-audit-v5`，对应评分 2.9.0。Case、权重、关键项和逐项数值映射保持，旧配置与旧报告保留。

## 先前正式交付

同一 Trial 的 Lead 在最后确认前可能已经发布完整报告。Outcome 与 Process 以 `prior_delivery` 接收这些先前公开、无收件人的 Lead 正文；只收取已验证派发边界内的消息。成员正文、私聊、寻址请求不能进入该类。校验根 Run 的 Lead 身份、消息清单、sequence 唯一性、正文摘要及 Evidence Index，任何缺失都明确失败。

按真实 sequence 编码相对顺序，模型只接收匿名引用和 `{order,text,limitation}`。先前交付用于解析最终引用和明确修订，不作为新的逐条评分声明；仍只审计当前最终响应和最新交付。后来的明确修订和最终工作区覆盖旧稿，不能挑选有利历史。

全部 Lead 交付最多 64 条、原文合计 160,000 UTF-16 单元；单段原文和投影 JSON 各不超过 50,000，受既有总体 310,000 组装预算约束。预算或清单不完整时调用前失败，不静默丢弃。原文按既有策略脱敏，不提供私有 ID 或隐藏过程。

`delivery_fact` 只核验报告是否已发布、发布内容及文本一致性。必须引用可见 `prior_delivery` 的逐字原文；不得认证实现或执行。测试成功仍要求实际执行回执，实现声明仍对照产物。公开报告不构成其内部断言真实性的独立证明，缺陷按适用检查项扣分，无法观察的断言保持未知。

## 有限运输恢复

新 CLI 配置每请求 360 秒、最多 2 次运输尝试、退避 3 秒；有效输出不重试，低分不重试，已完成但格式错误的响应不当作运输失败重试。超时明确记录 `semantic_judge_view.timed_out`。既有有限分歧复核政策保持，旧冻结配置不被改写。

双副本结论仍必须满足原规则；失败副本不能用另一份高分替代。所有副本、尝试、失败原因与有效响应保留。评分执行故障按 [Execution Evaluation v14](execution-evaluation-v14.md) 单列；来源不足或有效 Judge 分歧仍保持证据问题。变更与实测见[正式交付与有限恢复](../versions/v1.58/evaluation-delivery-recovery.md)。
