---
document_type: adr
id: ADR-0155
title: Treatment-Blind Outcome and Process Judge Views
status: accepted
date: 2026-08-11
decision_scope: cross-version
source_version: v0.55
supersedes: []
superseded_by: null
---

# ADR-0155: Treatment-Blind Outcome and Process Judge Views

## Context

现有 Semantic Engineering Review 把工程结果和协作过程放在同一 checklist 与同一 Judge Evidence Pack 中。
它能拒绝无引用的意见，却仍让 outcome verdict 看到 Member、角色、Message Delivery 和协作消息，因此不能作为
未来 Team/Solo 对照的 treatment-blind outcome measurement；反过来，只给 Process Judge Message/Run 数又会把
活动量误当成协作质量。完整 Evidence Reference 还携带 Trial 绑定，不应成为模型输入的一部分。

## Decision

Semantic Review 固定分成两个互不补偿的 Judge View。Process Judge View 只适用于观察到 team interaction 的
Trial，评估 delegation necessity、handoff clarity、member contribution value、feedback absorption 和 Lead
integration。其 Model-Visible Judge Pack 只允许伪名化角色、精确 Public A2A content、确定性 interaction facts，
以及判断贡献/吸收/整合所需的有界 delivered code、verification facts 和 final response。Agent、Call、Message、
Run 或 Task 数量本身不构成正面证据；没有 interaction 时全部 Process items 为 `not_applicable`，不调用 LLM。

Blinded Outcome Judge View 同时适用于 Team 与 Solo，只评估 requirements、solution fit、implementation quality、
verification adequacy、scope discipline、final-response claim accuracy 和 limitations。其模型输入只允许 disclosed
requirements、bounded delivered code、deterministic verification/workspace-change facts 和 final response，必须排除
Team/Solo/treatment 标签、Members、角色、Calls、协作消息、Runs、Trial/slot identity 和 authoritative Evidence ID。

每个 View 都使用冻结配置下的两个 tool/network/workspace-disabled Judge Replicas，Replica B 反转 checklist
presentation order。输出必须逐项引用该 item closure 内的本地 Evidence ID；本地 ID 到 Evidence Bundle Reference
的映射只保留在 audit-only artifact，不发送给模型。valid verdict 不选择性重试，不投票、不平均，不产生 view 间
或全局 collaboration score。两个 View 保留为一个 Semantic Judge View Suite，但仍不改变 Hard Outcome。

该分离只提高过程与结果的构念测量能力，不证明 Team 比 Solo 更有效。任何 collaboration uplift 或因果主张仍
必须来自另行预注册、同 Case/预算/环境的 paired counterfactual protocol。

## Consequences

Outcome verdict 可以在未来 Team/Solo paired trial 中使用相同的 treatment-blind Interface；Process verdict 则能
读取判断 semantic relation 所需的协作内容，而无需把 raw Runtime logs、hidden reasoning 或完整 ContextManifest
交给 LLM。审计者仍能从本地 Evidence ID 解析回权威 Evidence Reference，并重放配置、Pack、Replicas 与 Review
的绑定。

成本是每个适用 Trial 需要四次独立 Judge invocation，并产生两套 versioned Pack/Replica/Review artifacts。
Process contribution、feedback absorption 和 Lead integration 继续是 semantic inference；其 deterministic coverage
只能证明候选证据存在，不能证明因果关系。Outcome Judge 也不替代 deterministic Hard Checks。

Outcome blinding 由 closed field projection 保证结构隔离，并可用预注册 treatment canary 对 exact Requirement、code、
path 与 final response 做 contamination gate；它不宣称能从任意自然语言中可靠识别所有自我披露。未预注册且进入
delivery content 的 arm 暗示必须在未来 paired protocol 中作为 blind-eligibility 限制报告，不能让 LLM 自行忽略。

Public A2A content 按 Message identity 去重，fanout 只产生多个 interaction observation，不复制语义正文。消息投影
必须作为 immutable artifact 绑定原始 Message metadata、Delivery、Evidence Index 与 Collaboration Ledger；缺失绑定
是 `unavailable`，不是无协作。Replica 与 Review identity 还必须包含一次独立 Judge execution identity，允许复测而不
覆盖既有 artifact。

## Rejected Alternatives

- 继续用一个 combined Pack 被拒绝，因为 outcome verdict 会看到 treatment/process signals，协作 verdict 也难以
  单独解释。
- 只给 Judge Message/Run/Task counts 被拒绝，因为活动量不能证明 delegation、贡献或 integration 的价值。
- 把所有 Runtime logs、ContextManifest、Tool output 或 hidden reasoning 交给 LLM 被拒绝，因为会扩大泄漏、注入和
  不可重放表面，且混淆 source authority。
- 让 Outcome Judge 看 Team/Solo 标签后“自行忽略”被拒绝，因为 blinding 必须由 Pack construction 保证。
- 生成一个 collaboration 或 combined score 被拒绝，因为不同 semantic constructs 不可相互补偿，也不能改变
  Hard Outcome。

## References

- [v0.55 overview](../versions/v0.55/README.md)
- [Semantic Judge Views v1](../contracts/semantic-judge-views-v1.md)
- [Benchmark Protocol architecture](../architecture/benchmark-protocol.md)
- [ADR-0095](0095-layered-qualification-authority-and-semantic-review.md)
- [ADR-0098](0098-dual-replica-evidence-bound-semantic-judge.md)
- [ADR-0151](0151-versioned-benchmark-protocol-and-axis-comparability.md)
