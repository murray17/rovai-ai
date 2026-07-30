---
document_type: adr
id: ADR-0076
title: Message-First AgentRun Dispatch Boundary
status: accepted
date: 2026-07-30
decision_scope: cross-version
source_version: v0.24
supersedes: []
superseded_by: null
---

# ADR-0076: Message-First AgentRun Dispatch Boundary

## Context

ADR-0075 已将 Runtime 完整哈希移出消息发送热路径，但
`send_camp_message_request()` 仍在消息事务前执行 Pending Execution 准备和完整
`execution_preflight()`。该 Preflight 会检查 Runtime Readiness、重新验证工作目录，并通过
多次 Git 子进程采集仓库状态。只有这些步骤完成后，Core 才保存 CampMessage、CampTurn
和 AgentRun。

Renderer 同时没有本地消息投影。它等待 `camp.messages.send` 完整返回，再依赖最长约
1.4 秒一次的领域事件轮询刷新 Camp Snapshot。因此即使 Runtime 哈希已经移除，用户点击
发送后仍看不到即时反馈。

工作区安全、Runtime 可执行性和 Git 仓库观察都属于 AgentRun 执行边界，而不是用户消息
事实的成立条件。把这些检查放在发送边界会混淆“消息已提交”和“Agent 可以启动”。

本决策局部替代 ADR-0058、ADR-0066 和 ADR-0075 中把完整执行 Preflight、Runtime
Resolution 或工作区 launchability 放在 CampMessage 持久化之前的条款。目标解析、成员
身份、业务 Capability、冻结配置和事务一致性约束继续有效。

## Decision

### 1. Renderer 先乐观显示用户消息

点击发送后，Renderer 立即创建仅存在于本地的用户消息投影并放入当前 Camp 时间线：

- 使用 `commandId` 派生临时身份；
- 保留正文、寻址方式、目标成员和点击时间；
- 不显示“已送达”“执行中”或其他未经 Core 确认的状态文案；
- 自动滚动到最新消息。

Core 接受命令后，Renderer 使用权威 `campMessageId`、sequence 和 Camp Snapshot 对账。
Core 明确拒绝或 IPC 失败时才移除乐观投影并保留 Composer 草稿。事件轮询仍作为跨进程
变更和恢复的兜底，不再是本机用户发送后首次看到消息的必经路径。

### 2. 发送请求只提交消息与待执行 Run

普通 `camp.messages.send` 不创建新的 Pending Execution Intent，不执行
`execution_preflight()`，也不运行文件系统、Git、Runtime discovery、deep probe 或
完整性检查。

Core 在一个 SQLite 事务中完成仍可同步确定的领域操作：

- 验证 Camp、Actor、目标成员、Mention、Task 和业务 Capability；
- 创建缺失的目标 Conversation；
- 从最后可用的持久 Runtime 快照冻结 Run Runtime Configuration；
- 创建 CampMessage、CampTurn 和 queued AgentRun；
- 返回权威消息和 Run 身份。

Runtime 身份变化导致 capability snapshot 变为 stale 后，最后一次已验证快照仍可用于
创建可审计的 queued AgentRun；调度器随后阻止它启动并记录失败。消息不得因此被删除或
拒绝持久化。

### 3. 调度器拥有执行前检查

`dispatch_agent_runs()` 对每个可调度 Run 按以下顺序执行：

1. 轻量工作区安全检查：绝对路径、canonical identity、存在性、目录类型、可读性、受管
   数据目录边界；不启动 Git 子进程；
2. Runtime 检查：当前 Installation/Capability Snapshot 与冻结配置的一致性，以及
   ADR-0075 定义的轻量文件身份和条件完整 SHA-256；
3. 采集一次 starting Git observation；Git 不存在、不是仓库或状态异常只形成观察结果，
   不等同于工作区安全失败；
4. claim AgentRun、写入 `started_at` 和 starting observation；
5. 启动 Agent Runtime。

工作区或 Runtime 检查失败时，调度器直接把尚未启动的 queued AgentRun 标记为失败，
并让所属 CampTurn 进入失败或等待修复/重试状态；它保留触发用户消息，不写
`started_at`，也不伪造 starting/ending Git observation。

### 4. ending Git observation 属于终态

AgentRun 成功、失败或取消并已经实际开始执行时，Core 在终态边界采集一次 ending Git
observation。starting/ending observation 用于用户可见状态、未来 worktree 支持和变更
审计，不是消息发送准入，也不替代 Runtime 自己的文件权限模型。

### 5. 旧 Pending Execution Intent 仅作迁移恢复

普通发送不再创建 Pending Execution Intent。升级前遗留的可恢复 Intent 可以按新路径
提交其消息与 queued Run，成功后标记为 consumed；它们不再重新引入发送前 Runtime
Resolution。

## Consequences

- 用户消息在点击后立即可见，权威持久化只等待一次短 SQLite 事务。
- Workspace、Runtime 和 Git 成本全部退出交互热路径；调度器约 500 ms 的扫描周期只影响
  Agent 开始时间，不影响消息显示和保存。
- Pre-launch 失败成为 AgentRun 失败事实，CampTurn 可等待用户修复后重试；用户继续看到
  原始请求。
- Git observation 更准确地表达一次 Run 的开始和结束状态，不再表达消息发送时的仓库
  状态。
- 乐观投影必须以 `commandId` 和权威消息 ID 对账，避免轮询与直接刷新产生重复消息。

## Rejected Alternatives

- **仅在发送成功后立即刷新 Snapshot。** 消息仍会等待完整 IPC 请求，不能提供点击后的
  即时反馈。
- **只保留 Renderer 乐观消息，不移动 Core Preflight。** 视觉延迟下降，但消息实际持久化
  仍会被工作区、Git 和 Runtime 阻塞，失败语义继续错误。
- **让 Git observation 继续作为 Workspace 安全检查。** Git 能力和目录安全是不同事实；
  非 Git 目录也可以是合法 Run Workspace。
- **检查失败时不创建 AgentRun。** 会丢失“用户请求已保存但执行未能启动”的审计关系。

## References

- [ADR-0058：Collaboration v4](0058-collaboration-v4-presence-aware-admission.md)
- [ADR-0066：Managed Product Runtime](0066-managed-product-runtime-resolution.md)
- [ADR-0072：Directory Workspace and Dynamic Git Capability](0072-directory-workspace-and-dynamic-git-capability.md)
- [ADR-0075：Runtime Integrity Boundaries](0075-runtime-integrity-at-change-and-execution-boundaries.md)
- [v0.24 实施与验收](../versions/v0.24/implementation-plan.md)
