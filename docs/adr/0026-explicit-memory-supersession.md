---
document_type: adr
id: ADR-0026
title: "Explicit Memory Supersession"
status: accepted
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: null
---

# ADR-0026: Explicit Memory Supersession

## Context

一条 Memory 可能因为用户不再沿用而结束，也可能因为 Scope、Kind、Direction
变化或多条合并而被另一条 Memory 取代。若两种情况都只写成 `superseded` 状态，
系统无法回答旧认识被哪条新认识替代；若普通内容 Revision 也叫 Supersession，
又会混淆同一身份的历史与不同 Memory 身份之间的演进。

## Decision

Memory 的权威生命周期枚举为：

```text
active
retired
forgotten
```

Active Memory 可以进入 Agent 可读 Memory Projection 与未来搜索。Retired
Memory 停止沿用，但保留正文、Revision 历史和管理可见性。Forgotten 是终态，
其正文清除和最小 tombstone 规则由 v0.10 后续协议单独确定。

`superseded` 不作为 Memory 生命周期值。替代通过独立的
`MemorySupersession` 关系表达：

```text
predecessorMemoryId → successorMemoryId
```

创建 Supersession 必须是用户授权的权威命令，并在同一 SQLite 事务中把
predecessor 从 active 转为 retired、创建指向 successor 的稳定关系并追加审计
事件。没有 successor 的普通停止沿用只执行 retire。

同一 Memory 内发布新 MemoryRevision 不是 Supersession。只有创建了新 Memory
身份后，用户才可以从一个或多个旧 Memory 建立明确替代边。具体 merge/split
基数可以在 Schema 协议中收紧，但不得退化为没有 successor 的布尔标记。

## Consequences

- UI 可以区分“用户停止沿用”和“已被具体新认识替代”。
- Revision 历史保持同一 Memory 身份，Scope/Kind/Direction 迁移则通过新身份和
  显式关系表达。
- 替代关系需要引用完整性与循环检查；retire 与创建关系必须原子提交。
- Retired 内容仍占容量和本地存储，但不进入未来 Agent 上下文。
- Forgotten 的隐私语义仍需确保 Supersession 不通过残留正文或投影重新暴露内容。

## Rejected Alternatives

- `superseded` 作为无目标生命周期状态：无法解释被什么替代。
- 用 `supersededById` 可选列代替关系：过早限制合并或拆分，并把生命周期与图边
  混在一个字段。
- 每次新 Revision 都 supersede 旧 Memory：把内容历史错误建模为身份替换。
- 创建 successor 时自动终结来源：派生与生命周期是不同用户意图，必须显式确认。
- 只 retire 而不记录 successor：丢失跨 Scope、Kind 或合并时的演进关系。

## References

- [v0.10 长期记忆](../versions/v0.10/README.md)
- [ADR-0001: Core Transaction](0001-core-transaction.md)
- [ADR-0052: Explicit Memory Revision Authority](0052-explicit-memory-revision-authority.md)
- [ADR-0022: Immutable Memory Scope](0022-immutable-memory-scope.md)
