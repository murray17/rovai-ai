---
document_type: adr
id: ADR-0163
title: Explicit Caller Return and Core-Managed Reply Reference
status: accepted
date: 2026-08-12
decision_scope: cross-version
source_version: v0.62
supersedes: []
superseded_by: null
---

# ADR-0163: Explicit Caller Return and Core-Managed Reply Reference

## Context

Public A2A 已统一为 CampMessage 与 recipient-specific Message Delivery，但旧寻址合同同时把
reply author 当默认收件人，并把所有祖先目标视为新的 forward cycle。结果是子 Agent 即使明确
把结论发给直接调用者也会命中 `ancestor_cycle`；Agent 还必须复制内部 message ID 才能建立
回复引用。简单放宽所有 ancestor 校验会重新引入递归调用，而另加 `--return-to` 又会为同一
“发布并唤醒 Agent”行为制造第二套寻址语法。

## Decision

采用显式收件人、逐 Delivery 边类型和 Core 管理引用：

1. `camp.message.send` 的 Effective Recipients 只来自可重复 `--to agent_id` 与正文中的严格
   `@agent_id` Addressing Token。两者取并集并去重；没有两者时只发布公共消息，不唤醒 Agent。
2. 每个有效收件人独立分类。目标等于当前 A2A AgentRun 的 Immediate Caller 时，Delivery
   是 `return`；其他目标是 `forward`。同一消息可包含两类 Delivery，仍按完整收件人集合原子
   准入。
3. `return` 仍创建一个 Message Delivery 与一个新的 caller continuation AgentRun，也消耗一个
   CampTurn A2A/AgentRun budget slot。它恢复 Immediate Caller 原有的 parent、root 与 depth，
   同时由 Delivery 单独保留本次返回的 source Run 与被恢复的 caller Run。
4. `forward` 继续把 source Run 作为 target parent、将 depth 加一，并禁止 self、任何 lineage
   ancestor、depth overflow、fanout 或 budget overflow。`return` 只豁免精确 Immediate Caller；
   非直属祖先继续以 `ancestor_cycle` 拒绝。
5. 不增加 `--return-to`，也不允许 Agent 输入 `replyToCampMessageId`。Core 从当前 AgentRun 的
   `trigger_camp_message_id`（A2A 时与 `trigger_message_delivery_id → message_id` 交叉验证）自动
   写入新 CampMessage 的 `reply_to_camp_message_id`。
6. reply relation 只用于公共 thread 展示和有界 Context 引用闭包，永远不推导收件人或唤醒。
   Missing-Send Recovery Publication 继续是 recipient-free fallback，不解析 Addressing Token、
   不建立 Agent send 的自动 reply relation，也不唤醒 Agent。

本 ADR 局部覆盖 ADR-0130 Decision 3～5 中 reply-to default target、无返回边与统一 ancestor
处理的条款；公共消息、统一 Delivery、fanout、预算和原子准入继续与 ADR-0130/0131 组合生效。

## Consequences

- Agent 使用一套 `--to` / inline Mention 语法即可 forward 或返回，不需要知道内部 message ID；
- 用户仍看到一条公共消息，Core Read Side 可审计每个 recipient 的 `forward | return` 类型；
- retry、crash recovery 与 dispatch 必须复用持久化的 edge kind 和 target lineage，不能在重试时
  根据当前作者或 reply relation 重新推断；
- 返回会唤醒 caller，但仍受总 budget、recipient queue、Runtime readiness 和 settlement 约束，
  因此不会形成免费或无界 ping-pong；
- CampSnapshot、Data Contract 与 Built-in Tool Transport 需要发布新版本。

## Rejected Alternatives

- **新增 `--return-to`**：与 `--to immediate_caller` 都表示发布并唤醒一个已知 Agent，增加
  Agent 决策负担和互斥规则而没有新增领域能力。
- **reply author 自动成为收件人**：把消息引用边与执行边混合；public-only 回复会意外唤醒，
  reply metadata 还可能指向错误或过期目标。
- **允许任意 ancestor 作为 return**：无法区分栈式结果返回与跨层反向递归，破坏 lineage guard。
- **返回只发布消息、不创建 Delivery/Run**：不会唤醒 caller，也无法纳入队列、预算、恢复与
  settlement 权威。
- **返回复用旧 caller AgentRun 或 Native Session resume**：会改写终态责任并绕过一个输入对应
  一个新 AgentRun 的可审计边界。

## References

- [v0.62 版本目标](../versions/v0.62/README.md)
- [ADR-0130：Public A2A Message 与统一 Delivery](0130-public-a2a-message-and-unified-delivery.md)
- [ADR-0131：recipient-scoped Delivery 恢复](0131-recipient-scoped-event-driven-delivery-recovery.md)
- [ADR-0132：公共引用 Context Closure](0132-public-reference-context-closure-profile-v2.md)
- [ADR-0162：Missing-Send Recovery Publication](0162-missing-send-recovery-publication.md)
- [Camp Message Send v3](../contracts/camp-message-send-v3.md)
- [Message Delivery v2](../contracts/message-delivery-v2.md)
