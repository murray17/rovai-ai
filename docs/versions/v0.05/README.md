---
document_type: version-overview
version: v0.05
lifecycle: historical
authority: version-scope-and-status
last_updated: 2026-07-23
---

# Lumen AI v0.05 上下文治理与 Agent 间通信

> 状态：五个实施检查点均已完成并通过本机验收
>
> 文档规则：[文档导航](../../README.md)
>
> 跨版本约束：[ADR-0009](decisions.md#adr-0009)、[ADR-0011](decisions.md#adr-0011)
>
> 前置版本：[v0.04 主工作区导航](../v0.04/README.md)
>
> 实施与验收：[implementation-plan.md](implementation-plan.md)
>
> 更新日期：2026-07-23

## 版本目标

v0.05 让 Lumen 的多 Agent 从“同一 Camp 中存在多个独立 Runtime”前进到“能够获得明确、可恢复的上下文并可靠请求队友执行”。本版本交付两条闭环：

1. 每个 AgentRun 使用冻结、可审计、可精确重试的 Lumen 输入；Native Session 正常运行时只接收未读公共增量，重建时通过有条件摘要 Bootstrap。
2. 支持 Team Tool 的 Agent 可以通过 `team.post_message` 向同一 Camp 的另一成员发送私有执行请求，Core 原子创建消息和目标 AgentRun，并在重启后继续调度。

本版本不实现长期记忆/成长、不引入向量数据库、不增加 Completion Envelope、不提供通用工作流引擎，也不把 Antigravity App 未验证的工具注入路径冒充 A2A 支持。

## 当前实现基线

v0.04 已具备 Camp、成员、每成员唯一 Conversation、CampMessage/ConversationMessage、CampTurn、AgentRun、InboxMessage、Action/Approval、Runtime Adapter、Native Session 换绑和恢复。

开工时仍有以下明确差距：

- AgentRun 只冻结初始 Camp/Conversation 水位，Runtime 启动时仍从数据库临时读取消息；同一个 Run 没有不可变的 ContextManifest 和最终载荷。
- `conversation.last_seen_camp_message_sequence` 是公共前缀物化进度，不是 Native Session 已接收进度。
- Conversation 的 `summary` 是可变文本，没有覆盖范围、来源摘要、生成身份和不可变引用。
- Adapter 输入没有正式区分 Session Charter、动态 Turn Envelope、协作状态、控制信号、共享更新、Work Brief 与 Current Input。
- Inbox 已支持执行型目标 Run，但现有路径先创建 Run、再由 Dispatcher 写入目标 Conversation，尚未提供 Agent 可调用的 Team Tool 和可信 Runtime Binding。
- Codex/OpenCode/Copilot/Claude Code 的 MCP/Host 注入方式不同；Antigravity App 的 `agy` companion 尚无经验证的 Team Tool 注入路径。

## 实施进度

- **检查点 1 已完成（2026-07-23）**：v14 已增加 ContextManifest、ContextSummary、ContextCompactionAttempt、RuntimeInputDelivery、Native Binding 代际/投递游标与 A2A 链字段；Managed Blob GC 和 Camp 永久删除已纳入新引用与阻塞事实。
- v14 不猜测旧 Native Session 的接收水位：迁移会解除旧 Binding，把不可重现的非终态 Run 收敛为可人工重试失败，并记录迁移诊断。
- **检查点 2 已完成（2026-07-23）**：Runtime 只消费冻结 ContextManifest；正常增量不无条件摘要，超预算时才进入隔离压缩；附件只注入名称、类型、大小、受管位置和内容哈希，不注入正文。
- Codex 使用追加的 Developer Instructions、Claude Code 使用 `--append-system-prompt` 注入新 Session Charter；OpenCode、Copilot 与 Antigravity companion 在新 Session 的首次冻结输入中前置 Charter，均不替换 Adapter 自带 System Prompt。
- Native Session 在冻结输入前完成恢复或换绑；输入接受后才推进该 Binding 的公共游标，模糊结果进入 `delivery_unknown`。Codex、OpenCode、Copilot、Claude Code 与 Antigravity companion 的隔离压缩路径按各自能力执行。
- **检查点 3 已完成（2026-07-23）**：Core 已提供强类型 `team.post_message`、Native Binding 凭证、深度/Turn 配额及原子本地投递；一次成功事务同时创建 InboxMessage、接收方 ConversationMessage、投递 ACK 和目标 queued AgentRun。
- App 生命周期内唯一 Team Tool Gateway 通过权限收紧的 Unix Socket 接收调用，不打开额外网络端口；Provider 启动的无状态 stdio Connector 仅做协议转换并可随 Native Session 复用。凭据绑定 Native Binding/Generation，Core 每次调用动态解析当前 Run，换绑、旧 Epoch 和 Core 重启会 Fencing。
- **检查点 4 已完成（2026-07-23，后续兼容修订）**：Codex、OpenCode、Copilot 与 Claude Code 均具有追加式 Team MCP 注入路径；失败结果保持原始 Core 错误，不被 Provider 的成功输出 Schema 二次遮蔽。
- Codex 复用共享 App Server，并在每个 Native Thread 的启动/恢复请求中追加保留名称的 MCP Server；OpenCode 与 Copilot 为 Team Run 创建独立 ACP Host，避免 Binding 凭证和每 Run MCP 配置串入其他 Session。Copilot 配置文件使用私有权限并在 Host 退出时删除，崩溃残留在下次启动时清理。
- Team Tool 存在不授予发送权限；Core 在每次调用时仍按当前 Binding、Epoch、CampMember Capability、目标状态和 A2A 配额重新授权。Antigravity App 明确保持不支持。
- **检查点 5 已完成（2026-07-23）**：Camp Snapshot v2 已直接投影 Inbox/A2A 链、ContextManifest、Input Delivery 和条件压缩记录；Renderer 可区分排队、执行、等待与失败，并提供不泄露冻结 Prompt、摘要正文或附件正文的 Context Inspector。
- 真实 A→B→A 验收覆盖 Codex→Codex→Codex、Codex→OpenCode→Codex、Codex→Copilot→Codex 与 Codex→Claude Code→Codex。每条链均应形成 2 条 Inbox、3 个独立 AgentRun、3 份已接收 ContextManifest，并在 Core 重启后保持同一身份且不重复创建；短输入不得触发压缩。
- 打包 App 已在 1440×920 与 1040×700 验证活动/上下文视图、键盘焦点和无横向溢出。启动恢复会重新扫描 queued Run 与压缩任务；无法确认是否接收的输入只进入 `delivery_unknown` 安全阻塞，不盲目重发。

## 上下文协议

### 三层输入

```text
Adapter System Prompt
    Adapter 自带；Lumen 不读取、不替换。

Session Charter
    每个新 Native Session 追加一次。
    包含 Agent 身份、稳定协作协议、A2A 与升级规则。

AgentRun Payload
    每次 Run 使用冻结的 ContextManifest 渲染。
```

若 Adapter 支持追加系统/开发者指令，Charter 使用追加能力；只有替换能力时不用替换，改为首次实际 Run 载荷的前置区段。Charter 不单独触发模型请求，且不是权限安全边界。

### 每轮载荷

```text
[TURN_ENVELOPE]
消息来源、回复对象、触发类型、CampTurn、可选 Task

[COLLABORATION_STATE]
成员状态变化；本轮参与成员

[CONTROL_SIGNALS]
A2A 深度/数量预警、上轮路由失败、上下文过载或恢复状态

[SHARED_CONVERSATION_UPDATES]
当前 Native Binding 尚未接收的公共消息

[WORK_BRIEF]
由权威领域数据确定性组装的精简职责说明
[/WORK_BRIEF]

[CURRENT_INPUT]
当前用户或 A2A Prompt；附件只含元数据与稳定位置
```

消息正文必须使用不会与区段边界混淆的版本化编码。Shared Updates 明确声明为带来源的共享内容而非系统指令，每条至少包含 Camp Sequence、发送者类型/身份、Reply To、跨 Conversation 来源和正文。

### ContextManifest

每个 AgentRun 在首次 Dispatch 前只创建一个不可变 ContextManifest：

```ts
type ContextManifest = {
  id: string;
  agentRunId: string;

  nativeBindingGeneration: number;
  campMessageBoundarySequence: number;

  rawMessageRefs: EntityReference[];
  contextSummaryIds: string[];
  attachmentMetadata: Array<{
    attachmentId: string;
    name: string;
    mediaType: string | null;
    byteSize: number;
    locationRef: string;
    contentDigest: string;
  }>;

  workBrief: unknown;
  workBriefDigest: string;
  controlSignals: unknown;
  charterDigest: string;
  memberStateDigest: string;
  formatterVersion: number;

  renderedPayloadBlobId: string;
  renderedPayloadDigest: string;
  createdAt: string;
};
```

同一个 Run 的重试或恢复只使用这份冻结载荷。已经接受的输入 Resume 原 Native Turn；尚未接受可以原样重发；状态未知先对账。新消息不扩展旧 Run，而是进入之后的新 Run。

### Context Read Marker

Conversation 公共前缀物化游标继续表示数据库内的连续可见历史。Native Binding 另有自己的 Context Read Marker 和 Binding Generation。

正常 Resume：

```text
读取 Context Read Marker
→ 查询之后的公共消息连续区间
→ 过滤并按预算原文组装
→ Runtime 接受输入并返回稳定 Native Input ID
→ 持久化接收回执
→ CAS 单调推进 Marker
```

失败、取消或超时发生在 Runtime 接受之后时不回退 Cursor；接受前失败不推进；无法判断是否接受时进入 `delivery_unknown`。

### Bootstrap 与有条件压缩

首次进入、Native Session 重建/换绑或 Session Seal 后进入 Bootstrap。能够原文装入预算时直接使用原文，不无条件摘要。

只在 Bootstrap 历史或正常未读公共消息超过可用预算时，生成：

```text
较早连续区间 → ContextSummary
最近连续区间 → 原文
```

Summary 必须明确覆盖序列、来源摘要、可见性摘要、生成 Adapter/Model 和版本。生成使用隔离临时 Session，禁用 Team Tool、文件、Shell、网络和其他工具。压缩失败时 `waiting(context_compaction)`；压缩后必需载荷仍超限时 `waiting(context_overloaded)`，均不得跳 Cursor 或静默裁剪。

### 过滤与去重

公共区保留用户 CampMessage、其他 Agent 的公共最终回复和公开 Connector 消息。排除当前 Agent 自己已存在于 Native Session 的旧回复、thinking/stream/草稿、UI 状态、内部日志、系统摘要和私有消息。

当前用户消息若已经在 Shared Updates 中，只出现一次；A2A Inbox 触发消息属于目标 Conversation 的 Current Input，不会因此公开。CampMessage 对所有有效 CampMember 可见；v0.05 不引入 Whisper 或消息 ACL。

## Team Tool 协议

### 工具输入和结果

模型看到的工具保持窄化：

```ts
type TeamPostMessageInput = {
  recipientAgentId: string;
  body: string;
  inReplyToMessageId?: string;
  references?: EntityReference[];
};

type TeamPostMessageResult = {
  inboxMessageId: string;
  targetAgentRunId: string;
  correlationId: string;
  a2aDepth: number;
  remainingA2aHops: number;
  remainingTurnA2aRuns: number;
  status: "queued";
};
```

模型不能提供发送者、Camp、Conversation、源 Run、Epoch、CampTurn、Task、Correlation 或幂等键。Bridge 使用 Runtime Tool Call 的稳定身份生成幂等键；回复时 Core 从 `inReplyToMessageId` 继承 Correlation。

### 可信调用身份

Team MCP Bridge 携带绑定到当前 Native Binding 的不可伪造凭证。Core 每次调用动态解析当前唯一活跃的 AgentRun 和 executionEpoch，防止 Codex/OpenCode 复用 MCP Server 时把旧 Run 身份固化在启动参数中。旧 Binding、旧 Epoch、无活跃 Run或身份不唯一均拒绝。

### 原子 A2A 创建

成功调用在同一 SQLite 事务内创建 InboxMessage、目标 ConversationMessage、投递 ACK、目标 queued AgentRun 和审计事件。目标 Run继承源 `campTurnId` 和可选 `taskId`，但不改变 Task Assignee。事务提交后 Scheduler 根据权威 queued 状态运行；工具调用不等待对方完成。

每条消息创建一个独立 Run。同一目标繁忙时按序排队，不自动合并。接收方未配置、禁用、Runtime 不可用或 Adapter 不支持 A2A 时调用直接失败且零写入。

### 回复和收敛

需要请求方继续行动时，接收方显式再次调用 `team.post_message`。普通最终输出不会自动唤醒请求方，也不生成 Completion Envelope。失败事实进入 CampTurn、UI 和之后的 Control Signals。

```text
root Run depth = 0
成功 A2A → depth + 1
depth = 2 → 警告还剩 3 跳
尝试创建 depth = 6 → 拒绝

每 CampTurn 最多 16 个 A2A Run
达到 12 个 → 预警
达到 16 个 → 后续 A2A 拒绝
```

Retry、Rework 和投递重试不计入 A2A 总量。

## Adapter 范围

| Adapter | v0.05 Team Tool | 集成规则 |
|---|---|---|
| Codex CLI | 支持 | 共享 App Server；按 Native Thread 请求追加保留名称的 MCP 配置；原生延迟工具发现机制保持有效；动态配置变化触发换绑 |
| OpenCode CLI | 支持 | Team Run 使用独立 ACP Host；通过 ACP Session 的 `mcpServers` 追加工具；只对 `lumen_team_*` 增加窄化 Provider 许可 |
| Copilot CLI | 支持 | Team Run 使用独立 ACP Host；通过私有临时 `--additional-mcp-config` 追加，并只 allow `lumen_team`；再按能力加载 Native Session |
| Claude Code CLI | 支持 | 每次 `--print` / `--resume` 追加私有 `--mcp-config`；新 Session 用 `--append-system-prompt` 追加 Charter；不使用 `--strict-mcp-config` 覆盖用户 MCP；只读 Workspace 使用 fail-closed 权限并单独预授权 Team Tool |
| Antigravity App | 不支持 | 通过本机 `agy` companion 执行普通单 Agent Run；不能作为 A2A 发送方或接收方 |

本地验证使用 Codex CLI 0.145.0、OpenCode CLI 1.18.0、Copilot CLI 1.0.73、Claude Code CLI 2.1.206 与 Antigravity App companion 1.1.5，只作为 2026-07-23 的实施证据，不形成版本锁。每次执行仍按 v0.03 已确立的 Installation 探测和 Capability Snapshot 判断真实能力；上游升级后重新探测，不需要修改 Lumen 的固定版本清单。

## 非目标

- Agent 长期记忆、Fact/Lesson/Skill 进化与 Evaluation。
- Completion Envelope 或自动从最终输出生成 A2A 回复。
- Whisper、消息 ACL、跨 Camp Team Tool 或远端队列。
- 同步等待另一 Agent 完成的 RPC 语义。
- 动态无限 Agent、通用 Workflow/Decision/Review/Handoff 实体。
- Antigravity App Team Tool、通用外部 MCP Marketplace 或 Adapter 插件 ABI。
- 把附件全文、Provider 隐藏推理或上游内部摘要写入 Lumen Prompt。

## 完成定义

- ContextManifest、ContextSummary、Native Delivery Receipt 和 A2A 链数据已持久化并有 Migration/约束测试。
- 正常 Session 只得到未读公共增量；换绑 Bootstrap、有条件摘要、游标接受/失败/unknown 路径均可复现。
- 同一 AgentRun 的恢复不会吸收新消息或重建不同载荷。
- Codex、OpenCode、Copilot 与 Claude Code 的真实 Team Tool 链保持通过；Antigravity App 得到明确不支持错误。
- A2A 原子事务、忙碌排队、未就绪零写入、旧 Epoch 拒绝、深度/数量上限和重启恢复均通过破坏性测试。
- UI 能显示上下文构建/压缩/过载与 A2A 排队/失败，不要求用户阅读内部日志。
- Rust、TypeScript、Renderer、Smoke、生产构建和真实打包 App 验收通过后，才把本版本状态改为完成。
