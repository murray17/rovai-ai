---
document_type: version-overview
version: v0.17
lifecycle: historical
authority: version-scope-and-status
last_updated: 2026-07-28
---

# Rovai-ai v0.17 可中断执行与持久会话证据

> 状态：核心生产代码、Migration、Contracts 与自动测试已落地；真实 Runtime smoke
> 和打包 App 视觉验收尚未完成
>
> 文档规则：[文档导航](../../README.md)
>
> 前置版本：[v0.16 Runtime 权限归属与 Workspace 语义收敛](../v0.16/README.md)
>
> 跨版本决策：
> [ADR-0061](decisions.md#adr-0061) ·
> [ADR-0062](decisions.md#adr-0062) ·
> [ADR-0063](decisions.md#adr-0063)
>
> 详细设计：[architecture.md](architecture.md)
>
> 实施与验收：[implementation-plan.md](implementation-plan.md)

## 版本目标

v0.17 让 Camp 中一次执行具备三个同时成立的产品属性：

1. 用户能可靠停止整棵 CampTurn 执行树并立即继续工作；
2. Runtime 公开的 reasoning summary、步骤和工具证据在稍后打开或重启后仍可查看；
3. 这些用户可见证据永远不进入 Agent 的搜索、摘要、A2A 或后续上下文。

本版本同时整理会话呈现：Agent 内容使用安全 GFM，用户消息保持精确纯文本；
Task/A2A 系统更新改为结构化时间线卡；A2A 输入只保留最小来源说明，内部执行与回执
标识继续由 Core 后台关联。

## 已确认范围

### 1. Composer 中的 CampTurn 停止

Camp 有活动执行时，Composer 仍可编辑并保留草稿，原“发送”按钮在同一位置变为红色
“停止”按钮：

- 停止作用于当前 CampTurn 的全部 AgentRun 和 A2A 后代；
- Core 先建立 execution fence，阻止旧 Run 再写消息、工具调用或新 A2A；
- 对已连接 Runtime 发原生 interrupt；排队、等待或恢复中的 Run 也失去执行资格；
- `Enter` 在发送态提交、`Shift + Enter` 换行；输入法组合态、@候选选择和停止态
  都不误提交或误触停止；
- 整棵执行树完成 fencing 后立即恢复发送，不等待外部结果对账；
- 草稿不会因停止而清空。

停止不是回滚。已经交给 Runtime、Shell、文件系统或网络的操作可能已发生。存在未决
效果时，Run 显示：

```text
已停止 · 结果待确认
```

Rovai-ai 不把它伪装成未执行、已回滚或普通失败，也不自动重试。

### 2. AgentRun Execution Evidence

Runtime 明确公开的下列内容按 AgentRun 规范化并持久化：

- reasoning summary；
- 进展说明与 narration；
- plan 与结构化 step；
- tool call/result；
- command、file change 和其他可结构化的执行生命周期。

这些内容不是 CampMessage。它们写入独立 SQLite 权威记录，大内容使用 Managed Blob；
Run 完成后不删除，直到用户永久删除所属 Camp。

运行中执行披露外层默认展开；Thinking 在 reasoning 流结束后自动折叠，Progress
保持展开，Steps 默认折叠。进入 completed/failed/cancelled 等终态后，三者与外层
统一折叠为“Worked for …”式摘要。每个 AgentRun 单独拥有一组证据，并邻接自己的
最终消息，不能把多个 Agent 或同一 Agent 的多次 Run 合并成一条过程。

### 3. Agent 不可检索边界

Execution Evidence 仅供用户界面和授权审计读取，明确排除于：

- CampMessage / ConversationMessage；
- Camp FTS 与 `context.search`；
- Segment/Epoch Summary 与摘要模型输入；
- ContextManifest payload 与后续 AgentRun 输入；
- A2A body、A2A target context；
- Memory Proposal、Projection 或自动沉淀。

该边界在 Core 内容选择处通过 allowlist 强制，不依赖 Renderer 隐藏。

### 4. 安全 Markdown 与复制

- Agent 最终消息、reasoning summary、narration、plan 和 step 使用安全 GFM；
- 支持标题、列表、表格、引用、行内/围栏代码和安全链接；
- 禁止原始 HTML、脚本、事件属性和嵌入式远程内容；
- tool/command/file result 使用结构化组件，不把任意输出作为 Markdown；
- 用户消息保持原始纯文本，不解释 Markdown，可选择并提供键盘可访问复制；
- 复制结果使用当前成员名称投影，不重新暴露内部 handle。

### 5. Task 与 A2A 时间线卡

原始英文系统正文如：

```text
Task <id> changed status from pending to completed: <title>
```

不再直接显示。Task 变更使用紧凑、结构化、不可变的时间线卡，冻结事件发生时的标题、
原状态、新状态、负责人和时间；点击后打开右侧 Task Inspector，查看当前 Task 状态。
历史卡不会因 Task 之后改名、改派或再次变更而改写。

A2A 请求接受与目标结果同样使用紧凑事件卡，按真实 Camp sequence/time 插入时间线。
卡片只显示必要的发送方、接收方、状态和时间，不公开私有 A2A 正文或内部 Run ID。
消息仍按权威序号排序，不把 Lead 的最终回复人为移到其他 Agent 之前。

结构化卡属于 Camp 的公开边界事件展示；它不等同于 Execution Evidence。

### 6. 最小 TURN_ENVELOPE

普通用户消息触发的 Run 完全省略 `[TURN_ENVELOPE]`。

只有 A2A 消息触发的 Run 输出：

```text
[TURN_ENVELOPE]
From {{senderName}} ({{senderId}}); return results or follow-ups to the same agent.
[/TURN_ENVELOPE]
```

不再向模型暴露 `campId`、`campTurnId`、`agentRunId`、parent/root Run、
execution epoch、Task、trigger、reply message 或 `sourceInboxMessageId`。
旧 Run 恢复继续使用已冻结的旧 payload，不重新格式化。

### 7. 后台 A2A 回执关联

`team.post_message` 仍是唯一显式 A2A 发送动作。A2A target Run 如果显式向原发送
Agent 调用该工具、但省略 `inReplyToMessageId`，Core 可以从当前 Run 的可信 source
InboxMessage 后台补全关联。

该补全：

- 不暴露 correlation ID 给模型；
- 不自动发送；
- 不把普通 final answer 自动回给来源 Agent；
- 不自动唤醒来源 Agent；
- 不合并 Run 或消息；
- 不对发给第三方 Agent 的消息套用原 source linkage。

### 8. A2A 发送与接收能力继续分离

一个成员“在队且自己的执行引擎可准入”即可接收 A2A target Run，不要求它具备
`team_tool.post_message`。只有希望主动继续 A2A 的 Run 才需要其冻结 Runtime
真正提供 Team Tool capability。

不得按 Adapter 名称硬编码“不能接收 A2A”。Antigravity App/companion 的实际发送
能力以当前 Adapter 是否能注入并使用 Team MCP 为准；没有该能力时可以完成叶子 Run，
但不能伪造主动回信。

## 非目标

- 不保存或展示 Runtime 未公开的隐藏思维链。
- 不让 Agent 搜索、总结或读取 Execution Evidence。
- 不把 Stop 描述成事务回滚或外部副作用撤销。
- 不在取消后自动重试未知 Runtime 投递、命令或工具调用。
- 不自动将 Agent final answer 回送给 A2A 来源。
- 不用时间戳或 UI 到达顺序重排权威 CampMessage sequence。
- 不把 Task 变成工作流 DAG，也不让卡片替代 Task 当前状态真源。
- 不把用户消息改为 Markdown，也不执行 Agent 输出中的 HTML。
- 不引入第二数据库、Renderer 持久化真源或 event-replay 状态机。

## 升级策略

v0.17 使用 Core Migration v28：

- 新增 AgentRun Execution Evidence 权威存储、顺序约束与 Managed Blob 引用；
- 为 Camp 公共系统消息增加可判别的结构化 Task/A2A 展示载荷，保留安全文本 fallback；
- 不把历史 live Renderer 内存事件“补迁移”为证据，因为它们从未成为持久事实；
- 既有 CampMessage 与 Task 历史不批量改写；新事件开始使用结构化卡合同；
- 既有 ContextManifest payload 完全不改写；
- 新组装 payload 使用提升后的 formatter version 和最小 Turn Envelope；
- 未决 Runtime/Action/Delivery 记录原样保留，只把 Run 取消终态与效果确定性解耦。

已冻结的实现常量为：

- SQLite Migration：v28；
- Read Model schema：v9；
- Evidence inline 上限：16 KiB，超过后正文进入 Managed Blob；
- Renderer 初始快照按最新 1200 条 Evidence 有界恢复，截断正文可通过 Camp 授权的
  `agentRunEvidence.getContent` 读取。

## 验收模型

自动验证至少覆盖：

- fresh 数据库与 v0.16 fixture 升级；
- Evidence 幂等顺序、Run/Camp 归属、Blob 引用、截断和 Camp 删除 GC；
- App 重启、离开再进入 Camp、事件订阅断线后的 Evidence 恢复；
- FTS、摘要输入、ContextManifest、A2A 和后续 Run 对 Evidence 的反向泄漏测试；
- CampTurn stop 对 direct、多目标和多层 A2A Run 树的 fencing；
- Runtime interrupt 成功、无活动进程、delivery unknown 和外部结果未知路径；
- 取消后迟到 callback 不产生消息、工具调用、新 Evidence 或 A2A；
- Composer 草稿保留、红色停止按钮、快捷键不误停和 fencing 后恢复发送；
- safe GFM 表格/代码/链接，以及 HTML/script/远程嵌入阻断；
- 用户消息选择与复制；
- 每 Run 独立证据折叠、运行中展开、终态折叠和 reload 回显；
- Task 卡冻结历史字段、点击打开当前 Inspector；
- A2A request/result 卡的真实 sequence/time 和私有正文不泄漏；
- 用户 Run 无 Turn Envelope，A2A Run 只有精确最小区段；
- source Inbox ID 不出现在任何模型载荷；
- 显式 `inReplyToMessageId` 校验、同来源缺省补全、第三方目标不补全；
- 不自动回信、不自动唤醒、不合并 Run。

真实 App 验收覆盖 Meridian Day/Night、`1440×920` 与 `1040×700`、鼠标与键盘、
至少一个 Codex Run、一条跨 Agent A2A 链、停止中的真实 Runtime 以及重启后回显。

## 当前版本状态

截至 2026-07-28，ADR-0061、ADR-0062、ADR-0063、版本架构、Migration v28、
Read Model/Contracts v9、Core 执行证据与停止围栏、最小 A2A envelope、Desktop
折叠披露/安全 Markdown/Task 与 A2A 卡片均已落地。Core 单元测试、严格 Clippy、
Desktop 类型检查、Renderer 测试和 production build 已通过。

尚未完成真实 Runtime stop/reload/A2A smoke、打包 macOS App 的 Day/Night 双尺寸截图
与签名验收；因此当前状态不是最终 App 发布验收完成。详细证据与待办见
[实施计划](implementation-plan.md)。
