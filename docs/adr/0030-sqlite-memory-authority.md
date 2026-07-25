---
document_type: adr
id: ADR-0030
title: "SQLite Memory Authority and Read-Only Projection"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0032
---

# ADR-0030: SQLite Memory Authority and Read-Only Projection

## Context

Memory、Revision、Proposal、Supersession、容量与 Forget 需要共享一个可回滚的
事务边界。若按 Scope 保存的 Markdown 同时可写，文件和数据库会形成双真源；
外部编辑、并发用户确认和进程崩溃会让两者无法确定谁覆盖谁。

Memory 正文具有严格的小尺寸上限，不需要 Managed Blob 的流式大文件、内容寻址
和 GC 复杂度。用户仍需要可检查的人类可读视图，但 AgentRun 的恢复不能依赖一个
可能丢失或被外部污染的文件。

## Decision

现有 SQLite 数据库是 Memory Domain 的唯一权威存储。以下状态和短正文全部保存
在 SQLite：

```text
Memory
MemoryRevision
MemoryProposal
MemorySupersession
projection observations and diagnostics
```

MemoryRevision 与 MemoryProposal 的正文按版本限制为小型文本，直接使用 SQLite
字段，不存入 Managed Blob。新增、接受、修订、Lifecycle、Supersession、Forget、
容量校验、命令结果和脱敏事件在 ADR-0001 的同一 SQLite 事务中提交。

Lumen 在私有 userData 下生成按 Scope 组织的确定性 Markdown Memory Projection。
Projection：

- 只由权威 SQLite 状态生成；
- 对人类可读，但不是写入入口；
- 不被 Core 反向解析；
- 不进入 project、execution root 或 Git；
- 可以在缺失、损坏、formatter/schema 过旧或 digest 不匹配时完全重建。

Projection 文件使用原子替换和 Lumen-private 权限。具体目录、文件名、内容格式、
安全大小上限和 formatter version 在 v0.10 协议中定义。

ADR-0001 禁止在权威事务内执行文件系统 I/O。Memory 命令提交后发送 best-effort
typed Wake；Projector 根据 SQLite 权威状态、projection observation 和稳定扫描
重建文件。文件写入失败不回滚已经提交的 Memory，但必须保留诊断并可在重启后
恢复。不建立通用 Outbox。

Agent 搜索、召回、Memory Context 组装和 ContextManifest 冻结只查询 SQLite。
它们不得读取 Markdown，也不得因为 Projection 暂时失败而退回到过旧文件。

## Consequences

- 记忆确认、修订、并发保护、容量与 Forget 拥有一个明确事务真源。
- Markdown 可以被用户检查、删除或污染而不改变 Memory；Projector 会按权威状态
  重建并覆盖外部变化。
- 小正文直接进入 SQLite，查询和清除简单，但数据库承担全部 Memory 内容保密和
  备份责任。
- Projection 是含有记忆正文的敏感副本，需要私有权限、原子写入、诊断和
  Forget 后的确定性清理。
- Projector 与 Agent Context 读取分离，文件故障不会向 Runtime 注入陈旧记忆。

## Rejected Alternatives

- Markdown 作为唯一真源：难以提供事务、并发确认、幂等、Forget 和结构化查询。
- SQLite 与 Markdown 双向同步：冲突和恢复无法确定权威方向。
- 每条短正文使用 Managed Blob：对 2 KiB 级文本增加不必要的文件、GC 和引用
  生命周期。
- 在 Memory 命令事务中同步写 Markdown：违反 ADR-0001 的事务无文件 I/O 边界。
- Agent 从 Markdown 搜索或组装 Context：丢失或污染文件会改变执行输入。
- 把投影写入项目目录：会污染 repository、扩大可见性并可能进入 Git。

## References

- [v0.10 长期记忆](../versions/v0.10/README.md)
- [ADR-0001: Core Transaction](0001-core-transaction.md)
- [ADR-0009: Reproducible Context Materialization and Delivery](0009-reproducible-context-delivery.md)
- [ADR-0013: Managed Content and Read Side v2](0013-managed-content-and-read-side-v2.md)
- [ADR-0021: Atomic Memory and Immutable Revisions](0021-atomic-memory-and-immutable-revisions.md)
- [ADR-0027: Memory-Domain Forgetting](0027-memory-domain-forgetting.md)
