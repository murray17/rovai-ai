---
document_type: adr
id: ADR-0022
title: "Immutable Memory Scope"
status: accepted
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: null
---

# ADR-0022: Immutable Memory Scope

## Context

Hearth、Companion 和 Relationship 不只是展示分组；它们决定一条长期认识由谁
共同拥有，以及最多可以向哪些 AgentProfile 暴露。若普通 Revision 能把
Companion Memory 改成 Hearth Memory，内容更新就会同时完成一次不显眼的权限
扩大，历史审计也无法稳定回答旧 Revision 当时属于什么边界。

Relationship Scope 还以一对 AgentProfile 为身份。原地替换其中一位成员会把
同一个 Memory ID 解释成两段不同关系。

## Decision

Memory Scope 是 Memory 创建时固定的身份属性，只能是：

```text
hearth
companion(agentProfileId)
relationship(minAgentProfileId, maxAgentProfileId)
```

Relationship 成员对按稳定 AgentProfile ID 规范化为无序 pair。MemoryRevision
不能修改 Scope 或 Relationship 成员。

将内容提升到更宽作用域、收窄到更小作用域，或更换 Relationship 成员时，必须
创建新的 Memory 与首个 MemoryRevision。新 Memory 可以记录来源
`memoryId/revisionId` 作为派生引用，但派生关系不转移权限；目标内容必须独立
满足目标 Scope 的可见性和敏感信息规则。

创建目标 Memory 不自动修改来源 Memory。用户可以在同一权威命令中明确请求一个
独立的来源生命周期变化，但系统必须分别记录“创建派生 Memory”和“改变来源
Memory 状态”。在生命周期协议定稿前，不推断具体终态。

## Consequences

- 每个 Memory ID 在全部历史 Revision 中具有稳定的所有权和最大可见边界。
- Companion → Hearth 等权限扩大变成可识别、可确认、可审计的操作。
- 相同语义可能在不同 Scope 拥有不同 Memory ID，需要显式重复检测与派生关系。
- 投影目录可以按 Scope 稳定分组，但目录移动不能冒充领域变更。
- 用户若希望“移动而非复制”，UI 必须把创建目标与处理来源作为一个明确的复合
  选择，而不能在后台偷偷终结来源。

## Rejected Alternatives

- 把 Scope 放进 MemoryRevision：同一 Memory 的历史会跨越不同权限边界。
- 原地修改 Memory Scope：审计无法稳定解释旧内容对谁可见。
- 通过移动 Markdown 文件改变 Scope：文件是投影，不是授权或写入入口。
- 创建目标后自动删除来源：复制与生命周期是不同用户意图，自动合并可能造成
  数据丢失。
- Relationship pair 中原地替换成员：会把两段不同伙伴关系错误复用为同一身份。

## References

- [v0.10 长期记忆](../versions/v0.10/README.md)
- [ADR-0019: Application-Global Memory Ownership](0019-application-global-memory-ownership.md)
- [ADR-0020: User-Authorized Memory Mutation](0020-user-authorized-memory-mutation.md)
- [ADR-0021: Atomic Memory and Immutable Revisions](0021-atomic-memory-and-immutable-revisions.md)
