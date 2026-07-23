---
document_type: adr
id: ADR-0011
title: "Stable Team Tool Gateway and Native Binding Identity"
status: superseded
date: 2026-07-23
decision_scope: cross-version
source_version: v0.05
supersedes: [ADR-0010]
superseded_by: ADR-0014
---

# ADR-0011: Stable Team Tool Gateway and Native Binding Identity

## Context

Lumen 用 `team.post_message` 将一次 Agent 间执行请求原子写入 Inbox、目标 Conversation 和目标 `AgentRun`。Provider 侧通过 MCP stdio Connector 接入 Lumen Core。

早期实现把 Connector 凭据按 `AgentRun` 轮换。Codex 等 Runtime 会让同一 Native Session 复用已经启动的 MCP 进程；Session Resume 后，旧进程仍携带上一 Run 的凭据，因此合法调用会被误判为 `team_tool.binding_fenced`。把 Connector 生命周期强行缩到每 Run 又会破坏 Provider 自己的 Session/Host 复用。

## Decision

### Stable gateway, replaceable connectors

Lumen Core 在 App 生命周期内启动唯一 Team Tool Gateway（本地 Unix Socket）。它是工具调用的可信入口与授权者。

Codex、OpenCode、Copilot、Claude Code 等 Provider 可以按自己的 Host 或 Native Session 生命周期启动一个或多个无状态 MCP stdio Connector。Connector 只负责 MCP 与 Core IPC 的协议转换，不读取 SQLite、不持有业务状态，也不成为授权真源。Connector 重复启动或被 Provider 复用都不得改变工具语义。

### Native Binding credential

Connector 凭据绑定 `(nativeBindingId, nativeBindingGeneration)`，而不是 `AgentRun`。同一有效 Native Binding 在一个 Core 进程生命周期内重复准备配置时得到相同凭据；换绑、Binding Generation 变化或 Core 重启会产生新凭据。

凭据只证明调用来自某个 Native Binding。每次调用仍由 Core 动态解析该 Binding 当前唯一有效的：

```text
Conversation
→ running AgentRun
→ executionEpoch
→ CampTurn / Task
→ CampMember Capability
```

没有当前 Run、同时匹配多个 Run、旧 Binding、旧 Generation、旧 Epoch、已取消 Run 或权限不足时一律拒绝。稳定凭据不得把上一个 Run 的身份固化到 Connector 启动参数中。

### Tool and delivery semantics

Lumen 继续只提供 `team.post_message`。模型只能提交接收成员、正文、可选回复消息和允许的实体引用；发送者、Camp、源 Run、Epoch、CampTurn、Task、Correlation 和幂等键由 Core 推导。

成功调用在单个 SQLite 事务中完成校验、InboxMessage、接收方 ConversationMessage、投递 ACK、目标 queued AgentRun 和 `event_log`。提交后 Scheduler 通过权威 queued 状态恢复；工具成功不等待目标 Run 完成。A2A 不修改 Task Assignee。

每条请求建立独立 Run；回复必须显式再次调用工具。A2A 深度上限、每 CampTurn 数量上限、自发消息禁止、目标 Readiness、幂等与原子回滚规则继续由 Core 强制。

### Adapter surface

MCP 配置必须追加到 Provider 原生配置，不替换 Provider System Prompt 或用户已有 MCP：

- Codex CLI：App Server / Native Thread 配置；
- OpenCode CLI：ACP Session MCP 配置；
- Copilot CLI：ACP Host 的私有临时 MCP 配置；
- Claude Code CLI：每次 print/resume 显式传入私有 `--mcp-config`，并只预授权 Lumen 团队工具。

Antigravity App 通过本机 `agy` companion CLI 执行普通 Run；在其工具注入与调用协议可被本机验证前，不声明 Team Tool Capability，也不能作为 A2A 发送方或接收方。

Adapter 是否可用以当前本机 Installation 的能力探测为准，不使用固定版本白名单。

## Consequences

- Native Session Resume 不再因 AgentRun 更替而误用过期 Connector 凭据。
- App 生命周期 Gateway 与 Provider Connector 的生命周期解耦；Provider 可以保持自己的复用策略。
- Core 每次调用多做一次当前 Run 解析，但授权依据始终来自权威状态，不依赖启动时快照。
- Core 重启后旧 Connector 必然失效；Provider 必须由新 Host/Session 配置取得新凭据。
- Claude Code CLI 可参与 A2A，Antigravity App 仍被明确限制为非 A2A Runtime。

## Rejected Alternatives

- 每个 AgentRun 轮换凭据，同时让同一 Native Session 复用旧 MCP 进程。
- 把 `agentRunId` 与 `executionEpoch` 固化进长期 Connector 身份。
- 强迫所有 Provider 每个 Run 重建 Native Session。
- 让 Connector 直接读取 SQLite 或自行判断当前 Run。
- 用一个跨进程共享的 stdio MCP 进程替代 App Gateway。
- 在没有本机验证的情况下宣称 Antigravity App 支持 Team Tool。

## References

- [v0.05 上下文治理与 Agent 间通信](../versions/v0.05/README.md)
- [ADR-0006: Multi-Runtime Adapter Boundary](0006-multi-runtime-adapter-boundary.md)
- [ADR-0009: Reproducible Context Materialization and Delivery](0009-reproducible-context-delivery.md)
- [ADR-0010: Team Tool and Agent-to-Agent Execution](0010-team-tool-a2a-execution.md)
