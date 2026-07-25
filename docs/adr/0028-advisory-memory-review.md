---
document_type: adr
id: ADR-0028
title: "Advisory Memory Review"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0033
---

# ADR-0028: Advisory Memory Review

## Context

长期认识可能需要定期复核，尤其是从一次经历总结出的 Lesson。但若
`validFrom`、`validUntil` 或 Review 日期直接控制 Lifecycle，墙上时钟会在没有
用户命令、版本检查或审计事件的情况下改变未来 AgentRun 的行为。

明确具有起止时间的要求通常是当前计划、Task 或一次协作输入，而不是长期记忆。
同时为确认时间再保存 `acceptedAt` 会与 MemoryRevision 的创建事实重复。

## Decision

MemoryRevision 在用户正式命令提交时立即创建，`createdAt` 同时表达该版本的确认
时间。它只影响尚未冻结 ContextManifest 的后续 AgentRun。v0.10 不保存单独的
`acceptedAt`。

v0.10 不支持 `validFrom` 或 `validUntil`。未来生效和自动到期的要求继续由当前
输入、Task 或其他自然领域对象表达，不能通过 Memory 的时间窗口静默改变效力。

Memory 可以保存可选 `reviewAfter`。默认规则为：

```text
lesson      → 创建或修订当前 Revision 后 90 天
preference  → null
agreement   → null
```

用户可以为任意 Kind 手动安排 Review。`now >= reviewAfter` 只产生 Read Side 的
“建议复核”状态，不修改 Memory Lifecycle、MemoryRevision 或 Context 资格。
用户复核后可以通过显式命令继续沿用并重新安排、修订、retire 或 forget。

Review reminder 不自动创建 Proposal、消息、Task、AgentRun 或 Runtime Wake。

## Consequences

- Agent 行为不会仅因系统时间经过而无审计地改变。
- Lesson 获得默认治理提醒，但不会因为用户没有及时处理而突然失效。
- 首版无法表达“下周开始采用”或“月底自动失效”的 Memory；这类要求应留在
  Task 或当前上下文。
- Read Side 需要按当前时间派生 review-due 状态，但权威记录保持不变。
- 用户确认时间与 Revision 创建时间一致，减少重复字段和不一致风险。

## Rejected Alternatives

- `validFrom` 定时启用：引入无命令的行为变化和恢复时钟语义。
- `validUntil` 自动 retire：把临时要求误装进长期记忆，并绕过用户生命周期命令。
- Review 到期自动失效或删除：提醒不能代替用户治理决定。
- 为每个 Revision 另存 `acceptedAt`：与用户命令提交创建 Revision 的时间重复。
- 到期自动创建 Task 或 AgentRun：治理提醒不应隐式启动协作或 Runtime 工作。

## References

- [v0.10 长期记忆](../versions/v0.10/README.md)
- [ADR-0009: Reproducible Context Materialization and Delivery](0009-reproducible-context-delivery.md)
- [ADR-0012: Collaboration v3](0012-collaboration-v3-lightweight-task.md)
- [ADR-0020: User-Authorized Memory Mutation](0020-user-authorized-memory-mutation.md)
- [ADR-0026: Explicit Memory Supersession](0026-explicit-memory-supersession.md)
