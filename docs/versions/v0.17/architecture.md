---
document_type: version-architecture
version: v0.17
lifecycle: historical
authority: version-design
last_updated: 2026-07-28
---

# Rovai-ai v0.17 架构设计

> 版本范围：[README.md](README.md)
>
> 跨版本约束：
> [ADR-0061](../../adr/0061-durable-agent-inaccessible-execution-evidence.md) ·
> [ADR-0062](../../adr/0062-interruptible-runs-and-unsettled-external-effects.md) ·
> [ADR-0063](../../adr/0063-minimal-a2a-turn-envelope-and-reply-correlation.md)
>
> 相关既有约束：
> [ADR-0013](../../adr/0013-managed-content-and-read-side-v2.md) ·
> [ADR-0014](../../adr/0014-stable-team-tool-gateway-v2.md) ·
> [ADR-0016](../../adr/0016-multi-runtime-execution-v2.md) ·
> [ADR-0049](../../adr/0049-reproducible-context-delivery-v2.md) ·
> [ADR-0058](../../adr/0058-collaboration-v4-presence-aware-admission.md)
>
> UI 约束：[Meridian 详细规范](../../ui/meridian.md)

## 1. 权威对象与内容通道

v0.17 不把所有可见内容压成 CampMessage。每类事实继续由自己的权威对象拥有：

| 内容 | 权威对象 | 用户可见 | Agent 可检索/进上下文 |
|---|---|---:|---:|
| 用户公共消息 | CampMessage | 是 | 是 |
| Agent 公共最终回复 | CampMessage | 是 | 是 |
| 私有 A2A 正文 | InboxMessage / ConversationMessage | 仅授权范围 | 仅目标上下文 |
| reasoning summary / step / tool / command | AgentRun Execution Evidence | 是 | 否 |
| Task 当前状态 | Task | Inspector | 按既有 Task Context |
| Task/A2A 历史显示事件 | 结构化 Camp system message | 是 | 仅安全 fallback |
| Runtime permission | Runtime Permission/Approval 记录 | 是 | 按既有控制信号 |
| 外部效果确定性 | Action/Delivery/Runtime recovery 记录 | 是 | 不作为会话正文 |

核心不变量：

```text
user-visible ≠ CampMessage
user-visible ≠ Agent-readable
execution stopped ≠ external effects rolled back
timeline history ≠ current Task state
```

## 2. AgentRun Execution Evidence

### 2.1 规范化模型

物理 Migration 可以按现有命名习惯调整，但逻辑模型必须表达：

```ts
type AgentRunExecutionEvidence = {
  id: string
  campId: string
  campTurnId: string
  agentRunId: string
  sequence: number
  kind:
    | "reasoning_summary"
    | "narration"
    | "plan"
    | "step"
    | "tool_call"
    | "tool_result"
    | "command"
    | "file_change"
  phase: "started" | "updated" | "completed" | "failed"
  title: string | null
  preview: string | null
  structuredPayload: unknown | null
  contentBlobId: string | null
  contentByteCount: number
  isTruncated: boolean
  occurredAt: string
  durationMs: number | null
}
```

约束：

- `(agentRunId, sequence)` 唯一且单调；
- provider event identity 可用时建立幂等键；不可用时使用稳定 event type、phase、
  provider item ID 与内容摘要组合，不能用 Renderer 到达次数作为事实；
- `campId`、`campTurnId` 由 AgentRun 派生并校验，Renderer/Runtime 不提供；
- structured payload 使用关闭的 kind-specific schema，未知字段不直接透传 UI；
- `preview` 与 inline payload 有硬字节上限，超限显式 `isTruncated=true`；
- 大正文先写 Managed Blob，再在同一权威事务中建立 owning reference；
- provider raw packet、隐藏 reasoning 和 secret-bearing diagnostic 不进入表。

### 2.2 写入路径

```text
Runtime notification
→ Adapter parse
→ Core normalized public event
→ validate current Binding + Run + executionEpoch
→ normalize / redact / bound
→ persist AgentRun Execution Evidence
→ emit invalidation/live event
→ Renderer merges by stable evidence ID
```

被取消或 fenced 的旧 Run 不得创建新 Evidence。Runtime 的迟到通知若只用于收敛
Action/Delivery 结果，进入其所属恢复记录，不进入 Execution Evidence。

实时事件仍可降低 UI 延迟，但它不是事实源。Renderer 发现 sequence gap、重新进入
Camp 或重启后，从 snapshot/分页 API 读取 SQLite 权威记录并替换内存视图。

### 2.3 Read Side

CampSnapshot 至少返回每个可见 AgentRun 的证据摘要、总数、最后序号和是否有更多；
有界详情可以随 snapshot 返回，较大内容通过 `agentRunEvidence.*` 受控读取方法按
Run/证据 ID 获取。所有查询先校验 Camp 可见性，再分页。

Read Model 不返回 Managed Blob 本地路径。Renderer 也不从 live event 构建永久状态。

### 2.4 Agent 隔离

内容选择使用独立 allowlist：

```text
Camp context candidate sources
├── CampMessage
├── authorized ConversationMessage
├── Summary
├── Task/Control state
├── Memory projection
└── explicit attachment metadata

AgentRun Execution Evidence  ← absent by construction
```

下列入口必须有反向断言：FTS trigger、summary source query、ContextManifest builder、
context search、A2A context builder、Memory proposal source和任何“导出给 Agent”
API。不得先做一个混合 timeline 再靠 `kind != evidence` 过滤。

## 3. 取消状态机

### 3.1 CampTurn tree cancellation

停止命令以 CampTurn 为目标，Core 在事务中解析所有非终态 Run，包括同 Turn 中由
`a2aParentAgentRunId` 形成的后代：

```text
active CampTurn
→ cancel_requested
→ fence every non-terminal Run / invalidate current epoch
→ prohibit new messages, evidence, Team Tool calls and descendants
→ dispatch native interrupts where a live runtime exists
→ close queued/waiting/recovering execution eligibility
→ AgentRuns cancelled
→ CampTurn cancelled
```

停止命令和每个 Run 的 acknowledgement 幂等。进程 interrupt 可以成功、失败或没有
可用进程，但只有 fencing 完成是 Core 宣告“执行不会继续”的必要条件。

### 3.2 未决外部效果

现有 blocker 被拆成两组：

```text
execution ownership blocker
  - current unfenced runtime may still write
  - queued/waiting Run still eligible to dispatch
  - Team Tool binding still accepts current epoch

external certainty record
  - runtime input delivery_unknown
  - Action executing / outcome_unknown
  - command/tool interruption unconfirmed
  - native request result awaiting reconciliation
```

第一组必须在取消终态前关闭；第二组不阻止 Run/CampTurn 取消。Read Side 从第二组
派生 `hasUnsettledExternalEffects`、安全摘要和可导航对象，不把它覆盖成 cancel。

迟到回执只允许收敛原 Delivery/Action/Permission 记录。任何基于旧 epoch 的公共
消息、Evidence、Task、A2A 或新 Runtime 输入都失败关闭。

### 3.3 Composer 状态

```ts
type ComposerExecutionMode =
  | { kind: "send"; submitting: boolean }
  | { kind: "stop"; campTurnId: string; stopping: boolean }
```

- stop 模式由 authoritative snapshot 的活动 CampTurn 决定，不由 live badge 猜测；
- textarea 永远保持可编辑，切换 mode 不重建草稿 state；
- stop 模式按钮为 danger，label/aria-label 都是“停止”；
- `Enter` 只在 send 模式提交非空草稿，`Shift+Enter` 换行；输入法组合态和
  @候选选择优先；
- stopping 期间按钮防重复提交并显示明确状态；
- snapshot 确认整棵树 fenced/terminal 后切回 send；
- 若存在未决外部效果，在时间线/运行披露中警告，不继续占用发送按钮。

## 4. 会话呈现

### 4.1 Run 与消息对应关系

CampMessage 继续按 `camp_message.sequence` 排序。每条 Agent final message 通过
source AgentRun 关联自己的 Execution Evidence。没有 final message 的 canceled/
failed Run 仍在真实发生位置显示一条 Run 终态行及证据披露。

同一个 Agent 的多次 Run 不能合并；不同 Agent 并发产生的消息也不能按“Lead 应先
出现”的产品规则重排。若 A2A result 先于 Lead final 到达，UI 如实显示实际顺序。

### 4.2 执行披露

每个 Run 的披露头包含：

- 成员名称与身份色点缀；
- running/completed/failed/cancelled 文字状态；
- 持续时长；
- 证据数量和截断/未决效果提示；
- 展开/折叠控制。

运行中外层默认展开并随新 evidence 追加；Thinking 在 reasoning item 完成时自动
折叠，Progress 在 Run 活跃期间不因流结束而收起，Steps 默认折叠。进入终态时三者
与外层自动折叠一次。用户之后的手动展开/折叠在本次页面会话内保持，不因后续普通
rerender 抢回状态。重新进入 Camp 时，terminal 默认折叠；active 外层默认展开，
各内层按上述规则恢复。

### 4.3 Safe GFM

允许 Agent final、reasoning summary、narration、plan、step 使用一个统一安全 GFM
组件。安全策略：

- raw HTML 不解析；
- `script`、`iframe`、`object`、`embed`、事件属性和 CSS 注入不可达；
- 图片和其他远程嵌入不加载；
- `javascript:`、`data:` 等危险 URL 禁止；
- HTTP(S) 链接使用现有外部打开边界；
- 本地路径使用 Rovai-ai 受控 opener，不把任意 HTML anchor 权限交给 WebView；
- code block、table、list 和 blockquote 使用现有语义 Token；
- 超长代码/表格局部滚动，不制造整页横向滚动。

Tool call/result、command 和 file change 根据 structured payload 渲染；其 stdout、
stderr、diff 和参数默认按纯文本/代码处理，不经过 Markdown。

用户消息用纯文本换行展示。复制按钮与原生选择同时可用，且不把展示层已隐藏的
handle 重新写回剪贴板。

### 4.4 Task/A2A 结构化事件卡

新增 Camp system message presentation kinds：

```ts
type CampTimelinePresentation =
  | {
      kind: "task_event"
      taskId: string
      titleAtEvent: string
      fromStatus: TaskStatus | null
      toStatus: TaskStatus
      assigneeNameAtEvent: string | null
      occurredAt: string
    }
  | {
      kind: "a2a_event"
      event: "request_accepted" | "result_received" | "stopped" | "failed"
      senderNameAtEvent: string
      recipientNameAtEvent: string
      occurredAt: string
    }
```

结构化 payload 与安全、可本地化的 fallback body 同一事务写入，字段使用事件发生时
快照。Renderer 不解析旧英文 body 提取 Task ID。新卡片保持不可变；点击 Task 卡只用
`taskId` 打开 Inspector 当前状态，因此“历史发生了什么”和“Task 现在怎样”不会混淆。

A2A 卡不包含私有 body、内部 AgentRun ID、Inbox ID 或 execution epoch。卡的
CampMessage sequence 决定位置。request/result 各是一条实际事件，不为视觉完整性
补造不存在的回信。

## 5. Context Payload vNext

### 5.1 Formatter 分支

```text
trigger = ordinary user/public CampMessage
→ omit TURN_ENVELOPE entirely

trigger = A2A InboxMessage
→ append exact minimal text TURN_ENVELOPE
```

A2A 区段为：

```text
[TURN_ENVELOPE]
From {senderDisplayName} ({senderAgentProfileId}); return results or follow-ups to the same agent.
[/TURN_ENVELOPE]
```

不是 JSON。Formatter 不接受调用方预渲染字符串；它从经校验的 source
InboxMessage/AgentProfile 生成并转义不可表示的控制字符。`sourceInboxMessageId`
不出现在 `CURRENT_INPUT` 或其他模型区段。

formatter version 参与 ContextManifest 和 Binding compatibility。已经冻结的旧
payload 永不重建；只有新 Run 使用新格式。

### 5.2 后台 reply correlation

Team Tool Gateway 解析当前 Binding 得到：

```text
current AgentRun
→ trigger ConversationMessage
→ source InboxMessage
→ source sender AgentProfile
```

若 `inReplyToMessageId` 省略且 recipient 恰为该 sender，命令归一化阶段填入可信
source InboxMessage ID，并把派生关联纳入持久命令结果。显式值优先且按既有反向关系
验证；第三方 recipient 不推断。

工具调用本身仍由模型显式发起。Core 不监听 final message 代发、不因 Turn Envelope
自动唤醒、不把多个 target Run 聚合成来源 Run 的一条输出。

## 6. Contracts 与版本边界

计划新增/调整的公开合同：

- AgentRun snapshot 增加 evidence summary、持续时间和未决外部效果投影；
- Execution Evidence list/content Read Side；
- Camp system message 增加关闭的 `presentation` union；
- stop response 返回被 fencing 的 CampTurn/Run 数与未决效果提示；
- live runtime event 与持久 Evidence 使用稳定 evidence ID；
- Context formatter/version digest 更新。

不改变：

- `team.post_message` model-visible JSON Schema；
- AgentProfile/Member Presence；
- Task 当前领域模型；
- Runtime-owned permission；
- A2A target 的 Task 不继承规则；
- CampMessage sequence 权威排序。

## 7. 失败与恢复

| 场景 | 行为 |
|---|---|
| Evidence Blob 写入失败 | 不发布伪完整 evidence；Run 继续或失败按 Runtime 语义，记录诊断 |
| Renderer live event 丢失 | 从 SQLite snapshot/分页恢复 |
| Stop 时 Runtime 无响应 | fence Run，标 cancelled；显示结果待确认 |
| Stop 后 callback 到达 | 只允许收敛对应外部记录；其他写入拒绝 |
| Task 已删除/不可见 | 历史卡仍显示冻结文本，Inspector 导航禁用并说明 |
| A2A source identity 后来改名 | 已冻结 payload/历史卡不改；普通成员展示仍使用当前投影规则 |
| Explicit reply linkage 无效 | 工具调用失败，不使用隐式 fallback |
| Markdown 含 HTML/远程图片 | 作为文本或移除嵌入，不执行、不加载 |

## 8. 实现触点

| 模块 | 计划职责 |
|---|---|
| `db.rs` | Migration、Evidence 表/索引/Blob root、结构化 timeline payload |
| Runtime event handlers | 归一化并持久化 evidence，再发布 live invalidation |
| `runtime.rs` / cancellation coordinator | tree fence、interrupt、terminal/unknown 解耦 |
| `context.rs` | formatter version、普通省略、A2A 最小 envelope、隐藏 source ID |
| `team_tool.rs` | 可信 source reply correlation 补全 |
| `read_model.rs` / contracts | evidence、uncertainty、timeline presentation DTO |
| Electron Main allowlist | 新只读 Evidence API 与既有 stop 命令映射 |
| `App.tsx` / `CampWorkspace.tsx` | snapshot 合并、Composer stop、每 Run 披露和事件卡 |
| Markdown 组件 | safe GFM、链接策略、用户纯文本边界 |
| `styles.css` | Day/Night evidence、danger stop、card、Markdown token |

实现状态以[实施计划](implementation-plan.md)和代码/测试为准，不得从本设计文档推断
已经完成。
