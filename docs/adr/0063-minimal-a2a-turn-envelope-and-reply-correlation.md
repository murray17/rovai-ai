---
document_type: adr
id: ADR-0063
title: "Minimal A2A Turn Envelope and Trusted Reply Correlation"
status: accepted
date: 2026-07-28
decision_scope: cross-version
source_version: v0.17
supersedes: []
superseded_by: null
---

# ADR-0063: Minimal A2A Turn Envelope and Trusted Reply Correlation

## Context

当前 ContextManifest 为每个 AgentRun 都输出 JSON `TURN_ENVELOPE`，其中包含
`campId`、`campTurnId`、`agentRunId`、`taskId`、invocation、parent Run、
reply linkage 和 trigger 等执行控制字段。这些字段由 Core 强制执行，模型既不能
改变，也不需要依赖它们完成普通用户请求。将它们暴露给模型增加噪声，并鼓励模型在
正文或工具参数中复述内部标识。

A2A 接收方确实需要知道请求来自哪个 Agent，以及后续结果应返回给谁。但
`sourceInboxMessageId`、Run lineage 和 delivery correlation 仍属于可信后台状态，
不应变成模型负责维护的协议。与此同时，显式 `team.post_message` 语义不能被
“自动回信”取代：Agent 是否发送后续消息仍由它实际调用工具决定。

本 ADR 局部替代 ADR-0049“每个 AgentRun 都包含 Turn Envelope”及 Turn Envelope
优先占用输入预算的条款；ADR-0049 的 ContextManifest 冻结、字节级重发、Context
Read Marker、摘要和检索边界继续有效。

## Decision

### 普通用户 Run 不输出 Turn Envelope

由普通用户 CampMessage 触发的 AgentRun 完全省略 `[TURN_ENVELOPE]` 区段。不得输出
空区段、空 JSON、用户 sender 伪装或默认 Lead 接收说明。

Core 继续在 ContextManifest 和权威 Run 记录中冻结执行控制元数据，但 formatter
不把这些字段放入模型载荷。安全、身份、权限、配额、fencing、Task association 和
触发关系仍由 Core 执行，不依赖 prompt。

### A2A Run 只输出最小来源说明

只有 InboxMessage/A2A 触发的 AgentRun 输出以下文本区段：

```text
[TURN_ENVELOPE]
From {{senderName}} ({{senderId}}); return results or follow-ups to the same agent.
[/TURN_ENVELOPE]
```

- `senderName` 是组装时由 Core 解析的发送 Agent 显示名称；
- `senderId` 是发送 AgentProfile 的权威稳定 ID；
- 两者随 ContextManifest payload 冻结，重发同一 Run 时字节不变；
- 文本不得由消息正文或 LLM 参数提供；
- 区段中不再出现 JSON，也不出现 Camp、CampTurn、AgentRun、parent/root Run、
  execution epoch、Task、trigger、reply message 或 Inbox correlation ID。

`sourceInboxMessageId` 不得通过 `CURRENT_INPUT`、Work Brief 或其他模型区段旁路泄漏。
模型需要做出的唯一协作判断是：若要把结果或追问发回来源 Agent，显式调用
`team.post_message` 并选择该 Agent。

### Reply linkage 由后台补全

Core 在 A2A target AgentRun 中保留可信的 source InboxMessage 和 sender
AgentProfile 关联，但不把该关联 ID 暴露给模型。

当且仅当以下条件同时成立时，Core 可以为一次显式 `team.post_message` 调用补全
`inReplyToMessageId`：

1. 当前 Run 由一个有效 A2A InboxMessage 触发；
2. 模型没有显式提供 `inReplyToMessageId`；
3. recipient 是该 source InboxMessage 的原发送 Agent；
4. 当前 Binding、Run、epoch、Camp membership 和 capability 校验全部通过。

补全值来自当前 Run 的可信后台关联，并与新 InboxMessage 一起原子持久化。模型显式
提供 reply linkage 时继续按既有反向关系和可见性规则校验；无效值失败关闭，不回退
到隐式关联。发给第三个 Agent 时不得套用 source reply linkage。

这只是相关性补全：

- 不自动调用 `team.post_message`；
- 不把 Agent 的普通最终回复自动发给来源 Agent；
- 不自动唤醒来源 Agent；
- 不创建额外 AgentRun；
- 不合并同一 Agent 的多次 Run 或消息；
- 不改变一次工具成功只表示“已接受执行”的既有语义。

### Context 与控制面继续分离

A2A parent/root/depth、CampTurn、Task、execution epoch、idempotency 和配额仍从当前
认证 Binding 与权威数据库派生。它们可以用于审计、fencing、Read Side 和恢复，但
不得要求模型在 Turn Envelope、body、references 或 Team Tool 参数中回传。

## Consequences

- 普通用户 Run 获得更短、更自然的动态输入，不再看到无助于推理的执行元数据。
- A2A 接收方获得明确的来源和返回方向，但不会被迫维护后台 correlation ID。
- 忘记填写 `inReplyToMessageId` 不再丢失直接回信的后台链路；显式工具调用仍是
  唯一发送动作。
- Context formatter 版本必须提升；旧 Run 恢复继续字节级使用其已冻结 payload，
  不能按新格式重组。
- Context、Team Tool 和 idempotency 测试需要同时覆盖省略、最小区段、显式关联、
  隐式补全以及第三方目标不补全。

## Rejected Alternatives

- 所有 Run 保留 JSON Turn Envelope：向模型暴露无权控制且无助推理的内部字段。
- 普通用户 Run 输出空 Turn Envelope：仍然制造格式噪声和错误的协议暗示。
- 把 `sourceInboxMessageId` 写入最小区段：让模型承担本可由 Core 可靠维护的关联。
- Agent 最终回复自动返回来源 Agent：改变显式 A2A 协议并制造意外唤醒。
- 根据自然语言中的名称猜测 reply linkage：名称文本不是权威路由或关联来源。
- 对任何 recipient 都套用当前 source linkage：会产生错误的会话关系和越权侧信道。

## References

- [v0.17 可中断执行与持久会话证据](../versions/v0.17/README.md)
- [ADR-0014: Stable Team Tool Gateway v2](0014-stable-team-tool-gateway-v2.md)
- [ADR-0049: Reproducible Context Delivery v2](0049-reproducible-context-delivery-v2.md)
- [ADR-0058: Collaboration v4](0058-collaboration-v4-presence-aware-admission.md)
