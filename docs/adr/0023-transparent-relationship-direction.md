---
document_type: adr
id: ADR-0023
title: "Transparent Relationship Direction"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0035
---

# ADR-0023: Transparent Relationship Direction

## Context

Relationship Memory 属于一对无序 AgentProfile，但某些协作约定天然只要求其中
一方行动，例如“洛可向沐瓦交接前先给出验收口径”。如果所有条目都被解释成对称
义务，另一位伙伴会收到错误指令。

反过来，若 `directed` 被解释成只有一方可见的记录，Relationship Memory 就会
变成用户或 Agent 对另一位伙伴建立的隐藏观察档案。这既破坏共同协作的透明性，
也会混淆适用性与访问控制。

## Decision

每个 Relationship Memory 在创建时固定一个 Relationship Direction：

```text
mutual

directed {
  actorAgentProfileId,
  counterpartyAgentProfileId
}
```

`mutual` 表示该认识对 pair 双方的协作行为对称适用。`directed(A → B)` 表示该
认识主要指导 A 与 B 协作时的行为；它不能反向解释成 B 必须履行 A 的义务。

Direction 不改变访问边界。经过授权的用户以及 pair 中两位 AgentProfile 都可以
查看和搜索该 Relationship Memory。系统不建立只让 actor、counterparty 或其中
一方看见的 Relationship Memory。

Directed 的 actor 与 counterparty 必须是 Relationship Scope 中两个不同成员。
Direction 是 Memory 身份属性，不是 MemoryRevision 字段。mutual 与 directed
互换或调换 actor/counterparty 时创建新 Memory；来源 Memory 的处理遵守
ADR-0022。

无论 Direction 如何，Relationship Memory 都不得成为人格标签、能力评分或秘密
观察档案。Direction 只描述协作认识对谁的行为适用。

本 ADR 不决定 AgentRun 召回条件。后续协议必须根据当前 AgentProfile、相关协作
成员和 Direction 决定适用内容，同时保持用户与 pair 双方的管理透明度。

## Consequences

- 非对称协作约定可以被准确表达，而不会把义务错误施加给另一位伙伴。
- 双方能够检查和纠正影响彼此协作的长期认识，不存在隐藏 Relationship 档案。
- Read Side、搜索和管理 UI 必须区分“谁可见”与“主要对谁适用”。
- Relationship Memory 需要验证 pair 与 Direction 端点一致，投影也必须稳定
  显示方向。
- 如果未来确实需要 Agent 私有笔记，必须建立另一个明确的领域与安全模型，不能
  复用 directed Relationship Memory。

## Rejected Alternatives

- Relationship Memory 全部 mutual：无法表达真实的单方协作义务。
- Directed 表示仅 actor 可见：会形成对 counterparty 的隐藏档案。
- Directed 表示仅 counterparty 可见：混淆行为适用方和信息接收方。
- 把 Direction 放进 Revision：一次内容修订可以暗中改变义务承担者。
- 用自然语言中的名字推断方向：重命名、歧义和模型解释会破坏稳定语义。

## References

- [v0.10 长期记忆](../versions/v0.10/README.md)
- [ADR-0019: Application-Global Memory Ownership](0019-application-global-memory-ownership.md)
- [ADR-0022: Immutable Memory Scope](0022-immutable-memory-scope.md)
