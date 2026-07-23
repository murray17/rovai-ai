---
document_type: adr
id: ADR-0009
title: "Reproducible Context Materialization and Delivery"
status: accepted
date: 2026-07-23
decision_scope: cross-version
source_version: v0.05
supersedes: []
superseded_by: null
---

# ADR-0009: Reproducible Context Materialization and Delivery

## Context

Lumen 的 `Conversation` 是一个 CampMember 在 Camp 内的长期私有连续性，Native Session 只是可替换的 Runtime 句柄。Native Session 通常已经保存当前 Agent 自己的历史，但看不到其他成员之后产生的公共消息。每轮重新发送完整 Camp 历史会造成重复、成本增长和上下文污染；只按当前数据库临时拼装又会让同一个 AgentRun 在恢复后收到不同输入。

现有 `conversation.last_seen_camp_message_sequence` 表达公共消息已经物化进 Conversation 的位置，不代表内容已经被某个 Native Session 接收。二者复用会在 Runtime 接收失败、Session 换绑和崩溃恢复时越过尚未交付的消息。此前未决的 RT-02 也必须关闭：恢复同一个 AgentRun 时不能依据最新数据库重新组装“看起来相似”的输入。

## Decision

### Instruction layers

Adapter 自带的 System Prompt 永远保留。Lumen 不读取、不替换，也不把它当成可移植上下文。

每个新 Native Session 必须追加一次 Session Charter，包含 AgentProfile 身份与指令、稳定 Collaboration Contract、Team Tool 使用边界和升级给用户或 Default Lead 的规则。Adapter 优先使用原生的追加指令能力；只有替换 System Prompt 的能力时不得使用替换，而是在该 Session 第一次实际 AgentRun 输入前附加 Charter。Lumen 不为 Charter 单独产生一次模型调用。

每个 AgentRun 的动态输入由以下区段组成：

```text
Turn Envelope
Collaboration State
Control Signals
Shared Conversation Updates
[WORK_BRIEF] ... [/WORK_BRIEF]
Current Input + Attachment Metadata
```

公共消息、附件名称和其他用户/Agent 内容始终作为带明确来源的非系统内容编码，不能被提升为 Charter 或 Adapter System Prompt。

### Immutable ContextManifest

每个 AgentRun 在首次 Dispatch 前必须拥有唯一、不可变、可审计的 `ContextManifest`。至少冻结：

- Camp/Conversation 消息范围与稳定消息 ID；
- 使用的 ContextSummary ID；
- 当前输入及附件的稳定引用、名称、类型、大小和位置；
- 确定性 Work Brief 数据及摘要；
- Control Signals；
- Charter、成员状态和 Formatter 版本；
- 完整 Lumen 输入载荷的不可变 Blob 引用与内容摘要；
- Native Binding 代际与输入边界。

附件正文不进入 Lumen Prompt；模型通过既有 Runtime/Workspace 能力按权限读取附件位置。ContextManifest 只引用受管内容，不重新包装成 Artifact。

同一个 AgentRun 的恢复不得从当前数据库重新拼装输入。Runtime 尚未确认接受时可以重发完全相同的冻结载荷；已经确认接受时只能 Resume 对应 Native Session/Turn；投递结果不确定时必须先进入 `delivery_unknown` 对账，禁止盲目重发。之后出现的新消息只能触发新的 AgentRun。

### Separate Native delivery cursor

公共前缀物化水位与 Native Session 投递水位是两个不同事实：

```text
Conversation materialization cursor
    公共消息已经写入 Conversation 到哪里。

Native Binding delivery cursor
    当前 Native Session 已确认接收公共消息到哪里。
```

每个当前 Native Binding 保存独立、单调的公共消息投递游标。新建或换绑 Native Session 时建立新代际并进入 Bootstrap；旧 Binding 的游标不得直接冒充新 Session 已接收的内容。

组装输入时记录 `boundarySequence`。只有 Runtime 接受输入，且 Core 已持久化稳定的 nativeTurnId/nativePromptId 或等价接收回执后，才能以 Compare-and-Set 单调推进游标。之后的模型失败、取消或等待不回滚游标；接受前失败不推进；模糊崩溃先对账，不能猜测。

### Normal, Bootstrap and compaction paths

已有可 Resume Native Session 且存在投递游标时，正常路径只发送游标之后的未读公共增量，不重复旧历史，也不重复当前 Agent 自己已经存在于 Native Session 的旧回复。

首次进入、Native Session 重建/换绑或长期 Session Seal 后使用 Bootstrap。Bootstrap 输入包含 Conversation Summary、仍需保留原文的最近公共消息和当前职责。如果全部必要历史能够在预算内原文交付，则不得为了形式统一而生成摘要。

压缩只允许在以下条件触发：

1. Bootstrap 需要覆盖的历史超过可用公共上下文预算；
2. 正常路径的未读公共消息超过可用公共上下文预算。

较早内容由不可变 `ContextSummary` 覆盖，最近内容保留原文。游标只能跨过已经原文交付或被某个 Summary 明确覆盖的连续序列。不得周期性无条件压缩，也不得只保留最近消息后静默跳过旧序列。

`ContextSummary` 至少记录 Conversation、类型、覆盖起止序列、来源摘要、可见性摘要、正文、生成 Adapter/Model/版本和创建时间。生成使用隔离的 `ContextCompactionAttempt`：采用目标 Agent 的有效 Adapter/Model，但在临时 Session 中禁用 Team Tool、文件系统、Shell、网络和其他工具，只允许输出摘要。摘要是上下文基础设施记录，不是 CampMessage、Memory、Fact 或 Artifact。

压缩失败不推进游标。若摘要失败且必需内容无法装入预算，AgentRun 进入 `waiting(context_compaction)`；即使压缩成功后必需区段仍超过模型预算，则进入 `waiting(context_overloaded)`。系统不得在残缺上下文上静默执行。

### Visibility, deduplication and priority

CampMessage 对所有当前有效 CampMember 可见；Addressing 和 Reply 只影响路由，不是 ACL。私有 A2A 内容经 InboxMessage 进入目标 ConversationMessage，不自动变成公共消息。公开 Connector 消息可以进入 CampMessage，私有 Connector 内容仍留在相应 Conversation。

共享增量保留用户公共消息、其他 Agent 的公共最终回复和公开 Connector 消息；排除当前 Agent 自己的旧回复、thinking/stream/草稿、内部 UI/Runtime 日志、系统生成的 Context Briefing 和无权查看的私有内容。当前输入若已经包含在共享增量中不得再次附加；若因权限过滤未包含，也不得用 fallback 绕过权限。

预算优先保证 Current Input、Turn Envelope、Work Brief 和关键 Control Signals。成员清单首次完整注入，之后只在成员状态摘要变化时更新；本轮参与成员始终可见。Adapter 提供可靠上下文上限时使用该值，否则使用 Lumen 的保守默认并预留输出空间。

## Consequences

- 同一个 AgentRun 的 Lumen 输入可以按不可变载荷精确重试与审计，恢复不会吸收未来消息。
- Native Session 只接收未读公共增量；Session 换绑通过 Bootstrap 恢复 Lumen 持有的连续性，而不假装迁移 Provider 隐藏状态。
- 摘要具有覆盖范围、生成身份和完整性证据，Cursor 不会越过未交付内容。
- ContextManifest、Summary、Delivery Attempt 和受管 Blob 增加持久化与清理成本，但消除了“数据库有消息等于模型已看到”的错误假设。
- Charter 是协作指导，不是安全边界；权限、身份、配额、Fencing 和副作用仍由 Rust Core 强制。

## Rejected Alternatives

- 每轮重复发送完整公共历史。
- 复用 Conversation 物化游标作为 Native Session 投递游标。
- 恢复 AgentRun 时从最新数据库重新组装语义等价输入。
- 无条件周期摘要，或只保留最新消息并跳过未覆盖历史。
- 把附件全文默认内联进 Prompt。
- 用 Charter 替换 Adapter 自带 System Prompt。
- 压缩失败后在无提示的残缺上下文上继续执行。

## References

- [v0.05 上下文治理与 Agent 间通信](../versions/v0.05/README.md)
- [ADR-0016: Multi-Runtime Execution Boundary v2](0016-multi-runtime-execution-v2.md)
- [ADR-0007: Portable Conversation Handoff](0007-portable-conversation-handoff.md)
- [ADR-0012: Collaboration v3](0012-collaboration-v3-lightweight-task.md)
