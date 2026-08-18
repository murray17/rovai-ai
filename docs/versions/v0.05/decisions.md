---
document_type: version-decisions
version: v0.05
lifecycle: historical
last_updated: 2026-08-18
---

# v0.05 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0009](#adr-0009) | Reproducible Context Materialization and Delivery | `superseded` |
| [ADR-0010](#adr-0010) | Team Tool and Agent-to-Agent Execution | `superseded` |
| [ADR-0011](#adr-0011) | Stable Team Tool Gateway and Native Binding Identity | `superseded` |

<!-- legacy-adr:begin id=ADR-0009 source-file-sha256=4273fb69a4f401c06daa55e3b7d6c7ce11b3f22f97587ecdbe084d22df388fe0 -->
<a id="adr-0009"></a>

## ADR-0009: Reproducible Context Materialization and Delivery

迁移时原路径：`docs/adr/0009-reproducible-context-delivery.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0009
title: "Reproducible Context Materialization and Delivery"
status: superseded
date: 2026-07-23
decision_scope: cross-version
source_version: v0.05
supersedes: []
superseded_by: ADR-0049
```

<!-- legacy-adr-body:begin id=ADR-0009 -->
<a id="adr-0009-context"></a>
### Context

Lumen 的 `Conversation` 是一个 CampMember 在 Camp 内的长期私有连续性，Native Session 只是可替换的 Runtime 句柄。Native Session 通常已经保存当前 Agent 自己的历史，但看不到其他成员之后产生的公共消息。每轮重新发送完整 Camp 历史会造成重复、成本增长和上下文污染；只按当前数据库临时拼装又会让同一个 AgentRun 在恢复后收到不同输入。

现有 `conversation.last_seen_camp_message_sequence` 表达公共消息已经物化进 Conversation 的位置，不代表内容已经被某个 Native Session 接收。二者复用会在 Runtime 接收失败、Session 换绑和崩溃恢复时越过尚未交付的消息。此前未决的 RT-02 也必须关闭：恢复同一个 AgentRun 时不能依据最新数据库重新组装“看起来相似”的输入。

<a id="adr-0009-decision"></a>
### Decision

<a id="adr-0009-instruction-layers"></a>
#### Instruction layers

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

<a id="adr-0009-immutable-contextmanifest"></a>
#### Immutable ContextManifest

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

<a id="adr-0009-separate-context-read-marker"></a>
#### Separate Context Read Marker

公共前缀物化水位与 Context Read Marker 是两个不同事实：

```text
Conversation materialization cursor
    公共消息已经写入 Conversation 到哪里。

Context Read Marker
    当前 Native Session 已确认接收公共消息到哪里。
```

每个当前 Native Binding 保存独立、单调的 Context Read Marker。新建或换绑 Native Session 时建立新代际并进入 Bootstrap；旧 Binding 的 Marker 不得直接冒充新 Session 已接收的内容。

组装输入时记录 `boundarySequence`。只有 Runtime 接受输入，且 Core 已持久化稳定的 nativeTurnId/nativePromptId 或等价接收回执后，才能以 Compare-and-Set 单调推进 Marker。之后的模型失败、取消或等待不回滚 Marker；接受前失败不推进；模糊崩溃先对账，不能猜测。

<a id="adr-0009-normal-bootstrap-and-compaction-paths"></a>
#### Normal, Bootstrap and compaction paths

已有可 Resume Native Session 且存在投递游标时，正常路径只发送游标之后的未读公共增量，不重复旧历史，也不重复当前 Agent 自己已经存在于 Native Session 的旧回复。

首次进入、Native Session 重建/换绑或长期 Session Seal 后使用 Bootstrap。Bootstrap 输入包含 Conversation Summary、仍需保留原文的最近公共消息和当前职责。如果全部必要历史能够在预算内原文交付，则不得为了形式统一而生成摘要。

压缩只允许在以下条件触发：

1. Bootstrap 需要覆盖的历史超过可用公共上下文预算；
2. 正常路径的未读公共消息超过可用公共上下文预算。

较早内容由不可变 `ContextSummary` 覆盖，最近内容保留原文。游标只能跨过已经原文交付或被某个 Summary 明确覆盖的连续序列。不得周期性无条件压缩，也不得只保留最近消息后静默跳过旧序列。

`ContextSummary` 至少记录 Conversation、类型、覆盖起止序列、来源摘要、可见性摘要、正文、生成 Adapter/Model/版本和创建时间。生成使用隔离的 `ContextCompactionAttempt`：采用目标 Agent 的有效 Adapter/Model，但在临时 Session 中禁用 Team Tool、文件系统、Shell、网络和其他工具，只允许输出摘要。摘要是上下文基础设施记录，不是 CampMessage、Memory、Fact 或 Artifact。

压缩失败不推进游标。若摘要失败且必需内容无法装入预算，AgentRun 进入 `waiting(context_compaction)`；即使压缩成功后必需区段仍超过模型预算，则进入 `waiting(context_overloaded)`。系统不得在残缺上下文上静默执行。

<a id="adr-0009-visibility-deduplication-and-priority"></a>
#### Visibility, deduplication and priority

CampMessage 对所有当前有效 CampMember 可见；Addressing 和 Reply 只影响路由，不是 ACL。私有 A2A 内容经 InboxMessage 进入目标 ConversationMessage，不自动变成公共消息。公开 Connector 消息可以进入 CampMessage，私有 Connector 内容仍留在相应 Conversation。

共享增量保留用户公共消息、其他 Agent 的公共最终回复和公开 Connector 消息；排除当前 Agent 自己的旧回复、thinking/stream/草稿、内部 UI/Runtime 日志、系统生成的 Context Briefing 和无权查看的私有内容。当前输入若已经包含在共享增量中不得再次附加；若因权限过滤未包含，也不得用 fallback 绕过权限。

预算优先保证 Current Input、Turn Envelope、Work Brief 和关键 Control Signals。成员清单首次完整注入，之后只在成员状态摘要变化时更新；本轮参与成员始终可见。Adapter 提供可靠上下文上限时使用该值，否则使用 Lumen 的保守默认并预留输出空间。

<a id="adr-0009-consequences"></a>
### Consequences

- 同一个 AgentRun 的 Lumen 输入可以按不可变载荷精确重试与审计，恢复不会吸收未来消息。
- Native Session 只接收未读公共增量；Session 换绑通过 Bootstrap 恢复 Lumen 持有的连续性，而不假装迁移 Provider 隐藏状态。
- 摘要具有覆盖范围、生成身份和完整性证据，Cursor 不会越过未交付内容。
- ContextManifest、Summary、Delivery Attempt 和受管 Blob 增加持久化与清理成本，但消除了“数据库有消息等于模型已看到”的错误假设。
- Charter 是协作指导，不是安全边界；权限、身份、配额、Fencing 和副作用仍由 Rust Core 强制。

<a id="adr-0009-rejected-alternatives"></a>
### Rejected Alternatives

- 每轮重复发送完整公共历史。
- 复用 Conversation 物化游标作为 Native Session 投递游标。
- 恢复 AgentRun 时从最新数据库重新组装语义等价输入。
- 无条件周期摘要，或只保留最新消息并跳过未覆盖历史。
- 把附件全文默认内联进 Prompt。
- 用 Charter 替换 Adapter 自带 System Prompt。
- 压缩失败后在无提示的残缺上下文上继续执行。

<a id="adr-0009-references"></a>
### References

- [v0.05 上下文治理与 Agent 间通信](README.md)
- [ADR-0016: Multi-Runtime Execution Boundary v2](../v0.06/decisions.md#adr-0016)
- [ADR-0007: Portable Conversation Handoff](../v0.03/decisions.md#adr-0007)
- [ADR-0012: Collaboration v3](../v0.06/decisions.md#adr-0012)
<!-- legacy-adr-body:end id=ADR-0009 -->
<!-- legacy-adr:end id=ADR-0009 -->

<!-- legacy-adr:begin id=ADR-0010 source-file-sha256=367b825df18dff01d98800914076676c6f0c6b59c89d955850413a8bdb31e866 -->
<a id="adr-0010"></a>

## ADR-0010: Team Tool and Agent-to-Agent Execution

迁移时原路径：`docs/adr/0010-team-tool-a2a-execution.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0010
title: "Team Tool and Agent-to-Agent Execution"
status: superseded
date: 2026-07-23
decision_scope: cross-version
source_version: v0.05
supersedes: []
superseded_by: ADR-0011
```

<!-- legacy-adr-body:begin id=ADR-0010 -->
<a id="adr-0010-context"></a>
### Context

Lumen 已经有 Camp、每成员唯一 Conversation、CampTurn、AgentRun 和可靠 InboxMessage，但成员仍不能在执行中可靠请求另一成员工作。只让 Agent 在自然语言中提到另一成员不会建立明确职责、无法唤醒目标 Runtime，也无法在应用重启后判断请求是否已经被投递和执行。

Team Tool 需要跨 Codex、OpenCode 和 Copilot CLI 提供一致语义，同时不能让模型伪造发送者、Camp、Task 或 executionEpoch。A2A 也不能变成同步 RPC 或无限互相委派。

<a id="adr-0010-decision"></a>
### Decision

<a id="adr-0010-one-execution-tool"></a>
#### One execution tool

Lumen 提供唯一的执行型团队工具 `team.post_message`。它表示“向同一 Camp 的另一名成员发送私有执行请求并唤醒该成员”，不是普通通知。v0.05 不增加 `inform/request/response` 意图枚举，也不增加 Completion Envelope。

模型只提供目标成员、正文、可选回复消息和允许的实体引用。发送者、Camp、源 Conversation、源 AgentRun、executionEpoch、CampTurn 和可选 Task 均由可信 Team Tool Bridge 与 Rust Core 推导，模型不得填写或覆盖。

Team Tool Bridge 以不可伪造的 Native Binding 凭证连接 Core。Core 必须把它解析为当前唯一有效的 Conversation、AgentRun 和 executionEpoch；无当前 Run、存在歧义、Binding 已换代、旧 Epoch 或已取消 Run 的调用全部拒绝。同一 Conversation 同时最多一个能够调用 Team Tool 的活跃 AgentRun。

<a id="adr-0010-eligibility-and-atomic-local-delivery"></a>
#### Eligibility and atomic local delivery

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

<a id="adr-0010-turn-task-and-responsibility"></a>
#### Turn, Task and responsibility

目标 AgentRun 始终继承源 Run 的 `campTurnId`，并继承源 Run 的可选 `taskId`。模型不能通过 Team Tool 改变 CampTurn 或 Task。A2A 不改变 `Task.assigneeAgentId`；接收方只是为同一工作提供一次协作执行，不发生责任转移。独立新工作必须使用正式 Task 创建命令。

每条成功的 Team Tool 请求创建一个独立 AgentRun，不自动合并相似请求。对同一繁忙 Conversation 的多个 Run 按持久顺序串行执行，各自保留发送者、回复链、证据和终态。

回复仍使用同一个 `team.post_message`。回复继承 `correlationId`、通过 `inReplyToMessageId` 建立链，并在同一 CampTurn 中为原请求方创建新的 AgentRun。接收方普通最终输出只属于自身 Run，不自动转成 A2A 回复，也不自动唤醒请求方。需要对方继续行动时必须显式使用 Team Tool；Core 不从自然语言输出伪造回复。

<a id="adr-0010-loop-and-fan-out-limits"></a>
#### Loop and fan-out limits

A2A 链以原始用户/系统 Run 为深度 0。每次成功创建 A2A Run 深度加一：深度达到 2 时向模型提示还剩 3 跳；创建深度 6 的请求被拒绝，因此一条链最多 5 个 A2A Hop。

每个 CampTurn 最多创建 16 个 A2A AgentRun，达到 12 个时发出接近上限提示。Runtime 重试、人工 Retry、Rework 和 Inbox 投递重试不计入 A2A 数量。超限调用不创建 InboxMessage 或 AgentRun，返回结构化错误，调用方必须结束当前链或升级给 Default Lead/用户。

<a id="adr-0010-adapter-surface"></a>
#### Adapter surface

每个 AgentRun 都必须获得相同版本的 Team Tool 定义。Adapter 可以安全复用 Native Session 或 MCP Server，但重复注入不得产生重复工具注册；配置变化必须换绑 Native Session。具体 Host 生命周期属于 Adapter 实现，不成为领域不变量。

v0.05 的 Team Tool 支持 Codex CLI、OpenCode CLI 和 Copilot CLI。AGY CLI 保留普通单 Agent 执行能力，但在验证出可靠的每 Run 工具注入方式前既不能发送也不能接收 A2A 执行请求。Adapter 可执行版本由本机能力探测决定，不锁定到某个 CLI 版本。

<a id="adr-0010-consequences"></a>
### Consequences

- Agent 间请求具有明确的发送身份、目标职责、持久消息、可恢复 Run 和审计链。
- 本地原子投递消除了“Run 已排队但触发消息尚未进入 Conversation”的半状态。
- A2A 是异步执行协议，不把 Runtime Host 变成跨 Agent 同步调用栈。
- Task 责任仍然单一；协作 Run 不会通过消息隐式改派 Assignee。
- 显式回复要求比自动 Completion Envelope 更简单透明，但 Agent 忘记回复时只能由 Run/CampTurn 状态、Control Signals、Lead 或用户处理。
- 深度和数量上限会拒绝部分自主委派，但保证 CampTurn 必然收敛并限制成本。

<a id="adr-0010-rejected-alternatives"></a>
### Rejected Alternatives

- 把 Agent 名称写进 Prompt，依赖对方自行看到消息。
- 允许模型提供 senderAgentId、sourceAgentRunId、CampTurn 或 executionEpoch。
- Team Tool 成功后同步等待目标 Agent 完成。
- 接收方离线时创建无限期待处理 A2A 请求。
- 自动合并多条请求或用 InboxMessage 转移 Task Assignee。
- 从普通最终输出自动生成回复或 Completion Envelope。
- 不设深度和总量上限的递归委派。
- 在未经验证的 AGY 工具注入路径上宣称支持 A2A。

<a id="adr-0010-references"></a>
### References

- [v0.05 上下文治理与 Agent 间通信](README.md)
- [ADR-0004: Action & Safety](../v0.02/decisions.md#adr-0004)
- [ADR-0006: Multi-Runtime Adapter Boundary](../v0.03/decisions.md#adr-0006)
- [ADR-0008: Collaboration v2](../v0.04/decisions.md#adr-0008)
- [ADR-0009: Reproducible Context Materialization and Delivery](decisions.md#adr-0009)
<!-- legacy-adr-body:end id=ADR-0010 -->
<!-- legacy-adr:end id=ADR-0010 -->

<!-- legacy-adr:begin id=ADR-0011 source-file-sha256=14d5cf7e7fe8c02675d9722e0731802808a9627119e51f29d1d3d8a9c2ab2a7f -->
<a id="adr-0011"></a>

## ADR-0011: Stable Team Tool Gateway and Native Binding Identity

迁移时原路径：`docs/adr/0011-stable-team-tool-gateway.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0011
title: "Stable Team Tool Gateway and Native Binding Identity"
status: superseded
date: 2026-07-23
decision_scope: cross-version
source_version: v0.05
supersedes: [ADR-0010]
superseded_by: ADR-0014
```

<!-- legacy-adr-body:begin id=ADR-0011 -->
<a id="adr-0011-context"></a>
### Context

Lumen 用 `team.post_message` 将一次 Agent 间执行请求原子写入 Inbox、目标 Conversation 和目标 `AgentRun`。Provider 侧通过 MCP stdio Connector 接入 Lumen Core。

早期实现把 Connector 凭据按 `AgentRun` 轮换。Codex 等 Runtime 会让同一 Native Session 复用已经启动的 MCP 进程；Session Resume 后，旧进程仍携带上一 Run 的凭据，因此合法调用会被误判为 `team_tool.binding_fenced`。把 Connector 生命周期强行缩到每 Run 又会破坏 Provider 自己的 Session/Host 复用。

<a id="adr-0011-decision"></a>
### Decision

<a id="adr-0011-stable-gateway-replaceable-connectors"></a>
#### Stable gateway, replaceable connectors

Lumen Core 在 App 生命周期内启动唯一 Team Tool Gateway（本地 Unix Socket）。它是工具调用的可信入口与授权者。

Codex、OpenCode、Copilot、Claude Code 等 Provider 可以按自己的 Host 或 Native Session 生命周期启动一个或多个无状态 MCP stdio Connector。Connector 只负责 MCP 与 Core IPC 的协议转换，不读取 SQLite、不持有业务状态，也不成为授权真源。Connector 重复启动或被 Provider 复用都不得改变工具语义。

<a id="adr-0011-native-binding-credential"></a>
#### Native Binding credential

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

<a id="adr-0011-tool-and-delivery-semantics"></a>
#### Tool and delivery semantics

Lumen 继续只提供 `team.post_message`。模型只能提交接收成员、正文、可选回复消息和允许的实体引用；发送者、Camp、源 Run、Epoch、CampTurn、Task、Correlation 和幂等键由 Core 推导。

成功调用在单个 SQLite 事务中完成校验、InboxMessage、接收方 ConversationMessage、投递 ACK、目标 queued AgentRun 和 `event_log`。提交后 Scheduler 通过权威 queued 状态恢复；工具成功不等待目标 Run 完成。A2A 不修改 Task Assignee。

每条请求建立独立 Run；回复必须显式再次调用工具。A2A 深度上限、每 CampTurn 数量上限、自发消息禁止、目标 Readiness、幂等与原子回滚规则继续由 Core 强制。

<a id="adr-0011-adapter-surface"></a>
#### Adapter surface

MCP 配置必须追加到 Provider 原生配置，不替换 Provider System Prompt 或用户已有 MCP：

- Codex CLI：App Server / Native Thread 配置；
- OpenCode CLI：ACP Session MCP 配置；
- Copilot CLI：ACP Host 的私有临时 MCP 配置；
- Claude Code CLI：每次 print/resume 显式传入私有 `--mcp-config`，并只预授权 Lumen 团队工具。

Antigravity App 通过本机 `agy` companion CLI 执行普通 Run；在其工具注入与调用协议可被本机验证前，不声明 Team Tool Capability，也不能作为 A2A 发送方或接收方。

Adapter 是否可用以当前本机 Installation 的能力探测为准，不使用固定版本白名单。

<a id="adr-0011-consequences"></a>
### Consequences

- Native Session Resume 不再因 AgentRun 更替而误用过期 Connector 凭据。
- App 生命周期 Gateway 与 Provider Connector 的生命周期解耦；Provider 可以保持自己的复用策略。
- Core 每次调用多做一次当前 Run 解析，但授权依据始终来自权威状态，不依赖启动时快照。
- Core 重启后旧 Connector 必然失效；Provider 必须由新 Host/Session 配置取得新凭据。
- Claude Code CLI 可参与 A2A，Antigravity App 仍被明确限制为非 A2A Runtime。

<a id="adr-0011-rejected-alternatives"></a>
### Rejected Alternatives

- 每个 AgentRun 轮换凭据，同时让同一 Native Session 复用旧 MCP 进程。
- 把 `agentRunId` 与 `executionEpoch` 固化进长期 Connector 身份。
- 强迫所有 Provider 每个 Run 重建 Native Session。
- 让 Connector 直接读取 SQLite 或自行判断当前 Run。
- 用一个跨进程共享的 stdio MCP 进程替代 App Gateway。
- 在没有本机验证的情况下宣称 Antigravity App 支持 Team Tool。

<a id="adr-0011-references"></a>
### References

- [v0.05 上下文治理与 Agent 间通信](README.md)
- [ADR-0006: Multi-Runtime Adapter Boundary](../v0.03/decisions.md#adr-0006)
- [ADR-0009: Reproducible Context Materialization and Delivery](decisions.md#adr-0009)
- [ADR-0010: Team Tool and Agent-to-Agent Execution](decisions.md#adr-0010)
<!-- legacy-adr-body:end id=ADR-0011 -->
<!-- legacy-adr:end id=ADR-0011 -->
