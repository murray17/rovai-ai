---
document_type: adr
id: ADR-0080
title: "Durable Camp Composer Draft and Atomic Attachment Consumption"
status: accepted
date: 2026-07-31
decision_scope: cross-version
source_version: v0.25
supersedes: []
superseded_by: null
---

# ADR-0080: Durable Camp Composer Draft and Atomic Attachment Consumption

## Context

Camp Composer 原先只有 Renderer 内存中的正文。导航、重启或发送失败会丢失输入，
而附件准备又包含文件复制、摘要计算和安全检查，不能放进消息提交的短事务。附件也
不能脱离正文成为一种隐式消息，否则会破坏现有的公共消息语义、寻址和执行目的。

## Decision

1. 每个 Camp 至多有一个 Core 持久化的 `Camp Composer Draft`，保存完整正文和有序
   `Prepared Attachment` 集合。它是用户私有编辑状态，不是 Camp 消息、Agent
   上下文、事件或审计事实。
2. Draft 在 Camp 导航和应用重启后恢复；每次正文或附件变化刷新七天闲置过期时间。
   启动清理只删除已过期 Draft 及其尚未发送的附件文件。
3. 文件准备发生在消息事务之前。Core 复制普通文件、计算 SHA-256、限制数量和大小，
   并写入最终权威位置。目录、symlink 和其他非普通文件失败关闭。
4. 一条消息最多十个附件；单文件最多 25 MiB；Draft 附件总量最多 64 MiB。
5. 用户消息正文去除首尾空白后必须非空。纯附件消息不允许，也不生成占位正文。
6. 发送请求携带 Draft 中按顺序排列的全部 Prepared Attachment ID。Core 必须验证
   请求集合与当前 Draft 完全一致；不支持部分发送。
7. 消息提交事务原子创建 `CampMessage` 和 `Message Attachment`，同时消费 Draft。
   文件不在该事务中复制或重算。提交成功后正文与附件一起清空；提交失败时 Draft
   原样保留。
8. 运行中的 Camp 仍允许编辑正文和准备附件；现有执行准入继续阻止新消息提交。

## Consequences

- 用户可以在导航、重启和发送失败后继续编辑同一条消息。
- 消息事务保持短小，不承担大文件 I/O。
- Prepared Attachment 在发送前不是公共事实，Agent 无法从 Draft 读取它。
- Draft 过期会永久删除尚未发送的附件；UI 必须显示这是临时编辑状态。
- 发送成功后的重复命令通过命令幂等记录重放，不要求已被消费的 Draft 仍存在。

## Rejected Alternatives

- 只在 Renderer 保存 Draft：无法跨重启恢复，也不能成为附件所有权真源。
- 在发送事务中读取、复制和扫描文件：大文件 I/O 会延长 SQLite 写锁。
- 允许纯附件消息：会产生没有明确用户意图的公共消息和执行目的。
- 自动生成“请查看附件”等正文：这会伪造用户表达。
- 成功发送部分附件、保留失败项：消息边界将不再与用户确认的 Draft 一致。

## References

- [ADR-0001: Core Transaction](0001-core-transaction.md)
- [ADR-0076: Message-First AgentRun Dispatch Boundary](0076-message-first-agent-run-dispatch-boundary.md)
- [v0.25 Attachment Composer](../versions/v0.25/README.md)
