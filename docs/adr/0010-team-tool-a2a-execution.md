---
document_type: adr
id: ADR-0010
title: "Team Tool and Agent-to-Agent Execution"
status: accepted
date: 2026-07-23
decision_scope: cross-version
source_version: v0.05
supersedes: []
superseded_by: null
---

# ADR-0010: Team Tool and Agent-to-Agent Execution

## Context

Lumen 已经有 Camp、每成员唯一 Conversation、CampTurn、AgentRun 和可靠 InboxMessage，但成员仍不能在执行中可靠请求另一成员工作。只让 Agent 在自然语言中提到另一成员不会建立明确职责、无法唤醒目标 Runtime，也无法在应用重启后判断请求是否已经被投递和执行。

Team Tool 需要跨 Codex、OpenCode 和 Copilot CLI 提供一致语义，同时不能让模型伪造发送者、Camp、Task 或 executionEpoch。A2A 也不能变成同步 RPC 或无限互相委派。

## Decision

### One execution tool

Lumen 提供唯一的执行型团队工具 `team.post_message`。它表示“向同一 Camp 的另一名成员发送私有执行请求并唤醒该成员”，不是普通通知。v0.05 不增加 `inform/request/response` 意图枚举，也不增加 Completion Envelope。

模型只提供目标成员、正文、可选回复消息和允许的实体引用。发送者、Camp、源 Conversation、源 AgentRun、executionEpoch、CampTurn 和可选 Task 均由可信 Team Tool Bridge 与 Rust Core 推导，模型不得填写或覆盖。

Team Tool Bridge 以不可伪造的 Native Binding 凭证连接 Core。Core 必须把它解析为当前唯一有效的 Conversation、AgentRun 和 executionEpoch；无当前 Run、存在歧义、Binding 已换代、旧 Epoch 或已取消 Run 的调用全部拒绝。同一 Conversation 同时最多一个能够调用 Team Tool 的活跃 AgentRun。

### Eligibility and atomic local delivery

接收方必须是同一 Camp 的有效活跃 CampMember，具有可用且支持 Team Tool/A2A 的 Runtime。接收方忙碌时请求可以排队；未配置、禁用、Runtime 不可用或 Adapter 不支持 A2A 时立即返回结构化失败，不创建消息或 Run，也不留下无限离线队列。

一次成功调用在同一个 SQLite 事务内完成：

```text
校验身份、权限、配额和目标 Readiness
→ 创建 InboxMessage
→ 幂等创建目标 ConversationMessage
→ 写入 recipientMessageId / deliveredAt
→ 创建目标 queued AgentRun
→ 写入 event_log
```

任一步失败全部回滚。提交后只发送可丢失的 Scheduler Wake；启动扫描和周期扫描根据 queued AgentRun 恢复。因为本机 Inbox、Conversation 和 Run 位于同一 SQLite，Team Tool 不经过异步 Inbox Dispatcher。Dispatcher/租约只服务未来无法原子投递的来源。

工具成功只表示消息已经持久化、目标 AgentRun 已创建并排队，不等待目标开始或完成。

### Turn, Task and responsibility

目标 AgentRun 始终继承源 Run 的 `campTurnId`，并继承源 Run 的可选 `taskId`。模型不能通过 Team Tool 改变 CampTurn 或 Task。A2A 不改变 `Task.assigneeAgentId`；接收方只是为同一工作提供一次协作执行，不发生责任转移。独立新工作必须使用正式 Task 创建命令。

每条成功的 Team Tool 请求创建一个独立 AgentRun，不自动合并相似请求。对同一繁忙 Conversation 的多个 Run 按持久顺序串行执行，各自保留发送者、回复链、证据和终态。

回复仍使用同一个 `team.post_message`。回复继承 `correlationId`、通过 `inReplyToMessageId` 建立链，并在同一 CampTurn 中为原请求方创建新的 AgentRun。接收方普通最终输出只属于自身 Run，不自动转成 A2A 回复，也不自动唤醒请求方。需要对方继续行动时必须显式使用 Team Tool；Core 不从自然语言输出伪造回复。

### Loop and fan-out limits

A2A 链以原始用户/系统 Run 为深度 0。每次成功创建 A2A Run 深度加一：深度达到 2 时向模型提示还剩 3 跳；创建深度 6 的请求被拒绝，因此一条链最多 5 个 A2A Hop。

每个 CampTurn 最多创建 16 个 A2A AgentRun，达到 12 个时发出接近上限提示。Runtime 重试、人工 Retry、Rework 和 Inbox 投递重试不计入 A2A 数量。超限调用不创建 InboxMessage 或 AgentRun，返回结构化错误，调用方必须结束当前链或升级给 Default Lead/用户。

### Adapter surface

每个 AgentRun 都必须获得相同版本的 Team Tool 定义。Adapter 可以安全复用 Native Session 或 MCP Server，但重复注入不得产生重复工具注册；配置变化必须换绑 Native Session。具体 Host 生命周期属于 Adapter 实现，不成为领域不变量。

v0.05 的 Team Tool 支持 Codex CLI、OpenCode CLI 和 Copilot CLI。AGY CLI 保留普通单 Agent 执行能力，但在验证出可靠的每 Run 工具注入方式前既不能发送也不能接收 A2A 执行请求。Adapter 可执行版本由本机能力探测决定，不锁定到某个 CLI 版本。

## Consequences

- Agent 间请求具有明确的发送身份、目标职责、持久消息、可恢复 Run 和审计链。
- 本地原子投递消除了“Run 已排队但触发消息尚未进入 Conversation”的半状态。
- A2A 是异步执行协议，不把 Runtime Host 变成跨 Agent 同步调用栈。
- Task 责任仍然单一；协作 Run 不会通过消息隐式改派 Assignee。
- 显式回复要求比自动 Completion Envelope 更简单透明，但 Agent 忘记回复时只能由 Run/CampTurn 状态、Control Signals、Lead 或用户处理。
- 深度和数量上限会拒绝部分自主委派，但保证 CampTurn 必然收敛并限制成本。

## Rejected Alternatives

- 把 Agent 名称写进 Prompt，依赖对方自行看到消息。
- 允许模型提供 senderAgentId、sourceAgentRunId、CampTurn 或 executionEpoch。
- Team Tool 成功后同步等待目标 Agent 完成。
- 接收方离线时创建无限期待处理 A2A 请求。
- 自动合并多条请求或用 InboxMessage 转移 Task Assignee。
- 从普通最终输出自动生成回复或 Completion Envelope。
- 不设深度和总量上限的递归委派。
- 在未经验证的 AGY 工具注入路径上宣称支持 A2A。

## References

- [v0.05 上下文治理与 Agent 间通信](../versions/v0.05/README.md)
- [ADR-0004: Action & Safety](0004-action-safety.md)
- [ADR-0006: Multi-Runtime Adapter Boundary](0006-multi-runtime-adapter-boundary.md)
- [ADR-0008: Collaboration v2](0008-collaboration-v2.md)
- [ADR-0009: Reproducible Context Materialization and Delivery](0009-reproducible-context-delivery.md)

