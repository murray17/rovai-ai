---
document_type: adr
id: ADR-0021
title: "Atomic Memory and Immutable Revisions"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0052
---

# ADR-0021: Atomic Memory and Immutable Revisions

## Context

Memory Library 需要按家园、伙伴和伙伴对呈现人类可读内容，但一份作用域文档可能
包含数十条彼此独立的认识。如果整份 `current.md` 是一个可变聚合，修订其中一条
记忆会制造整文件版本冲突；单条遗忘、来源审计和并发确认也只能依赖脆弱的段落
位置或文本匹配。

长期记忆还必须保留用户曾确认过什么。原地覆盖正文会让历史内容、确认时刻和
陈旧 Proposal 的基准消失。

## Decision

每条原子长期认识建模为一个独立 `Memory`，拥有永久稳定的 `memoryId`。Memory
选择一个当前 `MemoryRevision`，并以自身版本参与乐观并发控制。

每个 `MemoryRevision`：

- 拥有独立 `revisionId` 并且只属于一个 Memory；
- 保存该次用户确认的完整内容；
- 发布后不可修改；
- 即使不再是当前 Revision，也作为独立审计历史保留，除非后续遗忘协议明确要求
  清除。

正式修订创建新 Revision，并以 Memory 当前版本和 `currentRevisionId` 执行
Compare-and-Set。旧 Revision 不原地更新。

新增 MemoryProposal 在用户接受时原子创建 Memory 与首个 MemoryRevision。
修订 MemoryProposal 必须记录目标 `memoryId` 和提出时的 `baseRevisionId`。
如果接受时目标 Memory 已推进到其他 Revision，该 Proposal 是陈旧建议，Core
必须拒绝直接覆盖；用户需要查看最新内容并重新确认。针对不同 Memory 的命令不因
共享一个展示文件而产生整文件冲突。

按作用域生成的 `current.md` 或等价人类可读文件是多个 Memory 当前 Revision 的
确定性只读投影。文件路径、段落顺序、行号和整文件版本都不定义 Memory 身份；
外部文件编辑不能成为领域写入入口。

本 ADR 不决定 Memory 的字段、生命周期、持久化真源或投影目录协议。

## Consequences

- 单条记忆可以独立修订、审计、停止沿用和遗忘。
- 陈旧 Proposal 有明确基准，不会覆盖用户后来确认的认识。
- 并发控制粒度与用户操作粒度一致，不需要锁住整份家园或伙伴文档。
- Read Side 和投影必须使用稳定 ID，而不能用正文内容或数组位置做身份。
- 不可变 Revision 增加记录数量与遗忘清理责任，但使历史与恢复语义可解释。

## Rejected Alternatives

- 每个作用域一份可变 Markdown 聚合：产生无关冲突，并把文本布局误当成身份。
- 每个作用域一个整文档 Revision：任何单条修改都复制并替换整组内容，审计和
  并发粒度过粗。
- 直接更新 Memory 正文：无法证明用户历史上确认的具体内容，也无法检测陈旧建议。
- 使用正文摘要作为 Memory 身份：合法修订会改变身份，重复或相似内容也会碰撞。
- 接受陈旧 Proposal 时最后写入者获胜：会静默覆盖较新的用户确认。

## References

- [v0.10 长期记忆](../versions/v0.10/README.md)
- [ADR-0001: Core Transaction](0001-core-transaction.md)
- [ADR-0009: Reproducible Context Materialization and Delivery](0009-reproducible-context-delivery.md)
- [ADR-0013: Managed Content and Read Side v2](0013-managed-content-and-read-side-v2.md)
- [ADR-0020: User-Authorized Memory Mutation](0020-user-authorized-memory-mutation.md)
