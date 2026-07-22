---
document_type: adr
id: ADR-0002
title: "Collaboration"
status: accepted
date: 2026-07-20
decision_scope: cross-version
source_version: v0.02
supersedes: []
superseded_by: null
---

# ADR-0002: Collaboration

## Context

v0.01 以 Project/Task 作为主要上下文，并把 Runtime 绑定到 Task；只有一个 Agent 能实际执行。v0.02 需要长期公共协作、每 Agent 私有连续性、按需 Task、多目标执行和可靠 Agent 间投递，同时不能强迫所有消息进入工作流。

## Decision

协作模型固定为：

```text
Camp
├── CampMember → AgentProfile
├── CampMessage
├── Conversation（campId + agentProfileId 唯一）
│   └── ConversationMessage / Summary / Camp Cursor / current Native Session
├── Task + optional TaskDependency
├── CampTurn
│   └── AgentRun → Conversation + optional Task
└── InboxMessage
```

不建立 Project、Team、TeamRun、AgentInstance 或 AgentProfileVersion。Camp 直接保存工作目录和可空稳定 Repository Binding；现有 Project 表只作为迁移来源/兼容数据保留。

### Addressing

消息地址是结构化值：`default / explicit agentProfileIds / broadcast`。解析只读取当前有效成员和唯一 Conversation，结果作为 CampMessage 的不可变地址快照写入同一事务。Default Lead 是未定向消息入口，不自动获得额外 Capability，也不绑定 Runtime。

### Messages and context

CampMessage 与 ConversationMessage 分别拥有作用域内单调序列。公共消息按连续前缀物化到每个 Conversation；一个 AgentRun 创建时冻结初始 Camp/Conversation 水位，后续无关消息不能进入该 Run。

### Task

Task 按需创建，状态仅为 `pending / in_progress / completed / cancelled`。创建时绑定唯一且不可变 Assignee；换人只能取消并创建带 `originTaskId` 的替代 Task。`blocked` 是 Readiness 投影。TaskDependency 只表达同 Camp 硬前置 DAG，不形成树、阶段或级联完成/取消。

### CampTurn and AgentRun

只有结构化 execution intent 创建 CampTurn/AgentRun。一个触发最多一个 CampTurn；多目标在同一事务创建多个 AgentRun。CampTurn 状态由当前职责 Run 聚合。AgentRun 使用六态 `queued / running / waiting / succeeded / failed / cancelled`，同一 Conversation 同时最多一个 running/waiting Run。

### Inbox

InboxMessage 是单接收者可靠投递。Dispatcher 以 Inbox ID 作为 ConversationMessage 幂等来源，并在同一事务写入目标消息和 `recipientMessageId/deliveredAt`。它不跟踪消费、不转移 Task 责任、不替代 Review/Task/Run。执行型 Inbox 必须先由 Core 创建或关联目标 Run。

## Schema and migration

- 新增 `camp`、`camp_member`、`camp_message`、`conversation`、`conversation_message`、`task_dependency`、`camp_turn`、`agent_run`、`inbox_message` 及必要证据关系。
- 现有 `task` 迁移为 v0.02 Task；legacy execution root/branch/base revision 转入迁移 AgentRun Workspace。
- 每个 legacy Project 至少迁移成一个 Camp；大厅迁移为无 Git Repository Binding 的 Camp。
- legacy RuntimeSession 的当前 Thread 迁入对应 Conversation；不迁移成 Session Chain。
- legacy Event/Approval 保持可审计关联，不能静默丢弃。
- 迁移完成前可以保留只读 legacy 表/列；新写入不得继续产生两套权威协作状态。

关键唯一约束包括：

```text
camp.repository_scope_id（非空时全局唯一）
(camp_id, agent_profile_id) on camp_member
(camp_id, agent_profile_id) on conversation
(camp_id, sequence) on camp_message
(conversation_id, sequence) on conversation_message
conversation.sourceCampMessageId / sourceInboxMessageId 的部分唯一索引
conversation.nativeSessionId 的非空部分唯一索引
(camp_id, trigger_type, trigger_id) on camp_turn
同一 Conversation 仅一个 running/waiting agent_run
职责 generation 与 predecessor 的唯一约束
(camp_id, idempotency_key) on inbox_message
```

## Failure semantics

- Camp/成员/Lead 变更与关联状态必须在一个事务维护不变量。
- 成员退出、Task/CampTurn 取消使用持久请求事实和 Finalizer，不提前写虚假终态。
- Inbox 写入目标 Conversation 后崩溃，重试只能复用同一 ConversationMessage。
- queued Run 启动前重新检查成员、Task、依赖、输入、Workspace、权限与 Conversation 锁。
- Agent 自述、Review 文本和系统通知不自动创建 Task、Run 或改变状态。

## Acceptance

- 普通消息可以只写 CampMessage，不产生 CampTurn/AgentRun。
- 单个多目标触发原子创建一个 CampTurn 和多个 Run，重复请求不复制。
- 两个 Agent 的 Conversation 独立推进，同一 Conversation 的 Run 串行。
- Inbox 在重复投递、进程崩溃、过期和永久失败时保持唯一消息/ACK。
- Default Lead 继任、成员退出、Task 取消和 Camp 归档在重启后收敛。
- v0.01 数据迁移后，用户仍能找到原项目、任务、消息、审批与当前 Thread。

## Consequences

- 公共协作、成员私有连续性、责任任务和执行生命周期由不同实体表达；UI、命令和查询不能继续用 Project/Task 或自然语言消息代替这些边界。
- 多目标执行、Conversation 串行化、Inbox 去重和成员变更需要数据库唯一约束、持久状态机与恢复扫描器共同维护。
- Task 保持按需和扁平，普通 Camp 消息不会隐式创建工作流；需要执行时必须提供结构化 intent。
- v0.01 数据需要经过兼容迁移，迁移完成前会同时存在只读 legacy 结构与新的权威协作模型。

## Rejected Alternatives

- TeamRun、TaskProposal、Task Tree、Handoff、结构化 Review、通用 Decision。
- 把所有消息解释为执行请求。
- 通过自然语言 `@name` 或 LLM 猜测权威地址。
- 让 InboxMessage 同时承担投递、消费和责任转移。

## References

- [v0.02 领域模型](../versions/v0.02/domain-model.md)
- [v0.02 核心组件与实施包](../versions/v0.02/core-components.md)
- [v0.02 实施与验收清单](../versions/v0.02/implementation-and-acceptance.md)
