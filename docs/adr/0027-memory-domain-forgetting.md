---
document_type: adr
id: ADR-0027
title: "Memory-Domain Forgetting"
status: accepted
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: null
---

# ADR-0027: Memory-Domain Forgetting

## Context

用户需要让一项长期记忆不再被保留或影响未来行为。仅把状态改成 `forgotten`
却继续保存 MemoryRevision、已接受 Proposal 和 Markdown 明文，不构成诚实的
遗忘。

同时，Memory 内容可能最初来自 CampMessage、Task、Git Commit 或其他自然领域
对象，也可能已经被冻结进已完成 AgentRun 的 ContextManifest 或上游 Native
Session。跨领域改写这些历史会破坏 ADR-0049 的执行可重现性；Lumen 也无法控制
Time Machine、文件系统快照、用户复制品或 Provider 历史。

## Decision

Memory Forget 是用户发起、不可恢复的 Memory Domain 清除命令。它必须：

- 将 Memory 转入终态 `forgotten`；
- 删除或不可逆清空该 Memory 的所有 MemoryRevision 可读正文；
- 清空与该 Memory 已接受路径关联的 MemoryProposal 可读正文；
- 从搜索、Agent 可读 Memory Projection 和 Memory 导出中移除该 Memory；
- 阻止旧 Revision、旧 Proposal、Supersession 或其他引用重新激活内容。

系统只保留安全和审计所需的最小 tombstone，例如 `memoryId`、`forgottenAt` 和
必要命令标识；Proposal 可以保留提案者、时间及 Camp/Run 的不透明来源标识，但
不能保留提案正文。ADR-0001 要求的永久 `command.result` 和 request digest
继续存在，事件与结果 payload 只能保存 ID、状态、脱敏摘要或摘要值，不能复制
Memory/Proposal 明文。

Forget 不删除或改写：

- 原始 CampMessage、ConversationMessage、Task、AgentRun、Action 或 Git Commit；
- 已完成 AgentRun 的不可变 ContextManifest 及其历史载荷；
- 上游 Native Session 或 Provider 保存的历史；
- 操作系统快照、Time Machine、用户导出或其他不受 Memory Domain 控制的备份。

旧 ContextManifest 可以继续证明某次 Run 当时使用过某个 Revision，但 Forgotten
内容不能由该历史路径重新导入 Memory Library、参与新搜索或注入新 AgentRun。

产品文案必须把该操作称为“从长期记忆中遗忘”或等价的领域限定表达，不能宣称
法律级全局擦除或外部副本销毁。仅希望停止未来使用并保留正文时，用户应执行
retire。

## Consequences

- 用户可以不可逆地清除 Memory Library 中的可读内容，而不会让停用条目继续潜伏
  在投影或导出中。
- 执行历史和自然来源对象保持真实，不因 Memory 生命周期被篡改。
- Memory 相关命令、事件和结果从第一天起就必须避免永久复制明文，否则无法兑现
  Forget。
- 管理 UI 必须明确 retire 与 forget 的差别，并对不可恢复操作进行显式确认。
- Lumen 无法承诺 SQLite 页、WAL、OS 快照或外部 Provider 的取证擦除；更强保证
  需要单独的加密、介质和备份生命周期设计。

## Rejected Alternatives

- Forgotten 只改状态但保留正文：内容仍可泄露、导出或被错误召回。
- Forget 级联删除原始来源：Memory 不拥有 Camp、Task、Commit 或 Action。
- 重写已完成 ContextManifest：破坏不可变执行输入和恢复审计。
- 宣称清除 Native Session 与系统备份：Lumen 不拥有或无法证明这些副本已销毁。
- Forget 可撤销：与不可恢复内容清除的用户预期冲突；可恢复停用应使用 retire。

## References

- [v0.10 长期记忆](../versions/v0.10/README.md)
- [ADR-0001: Core Transaction](0001-core-transaction.md)
- [ADR-0009: Reproducible Context Materialization and Delivery](0009-reproducible-context-delivery.md)
- [ADR-0013: Managed Content and Read Side v2](0013-managed-content-and-read-side-v2.md)
- [ADR-0025: Proposal-Scoped Memory Provenance](0025-proposal-scoped-memory-provenance.md)
- [ADR-0026: Explicit Memory Supersession](0026-explicit-memory-supersession.md)
