---
document_type: version-decisions
version: v1.50
lifecycle: current
last_updated: 2026-09-05
---

# v1.50 决定

<a id="v1-50-d01"></a>
## V1.50-D01：复用现有执行聚合，以冻结 route 和封闭 policy 建立私有 Single Chat

### 背景

Camp 内单聊既可以建立独立消息/执行系统，也可以复用现有 Conversation、CampTurn、AgentRun、Context Delivery、
Native Binding 与 Execution Evidence。独立系统会复制调度、取消、恢复与 Runtime Adapter；仅靠 Prompt 约束输出又不能
阻止 Built-in public send 或 terminal 路由泄漏。

### 决定

Single Chat 是 `Conversation(kind=single_chat)` 的封闭模式。每轮仍创建现有 CampTurn 与 AgentRun，并在准入时不可变
冻结 `invocationKind=single_chat`、`responseDelivery=conversation_message`、`operationPolicy=single_chat_v1` 和目标
Conversation。Core 在 Built-in Router 与通用 operation 边界执行固定 allowlist；terminal service 只向冻结目标写入
private ConversationMessage，不创建 CampMessage、Channel delivery 或 Missing-Send Recovery。

### 后果与被拒绝方案

- 复用现有 Scheduler、Fleet、Binding、Evidence 和 Cancellation，普通 Camp 投影在查询边界排除 Single Chat。
- Bootstrap 不投递 Memory，Skill exposure 在 Manifest/Adapter 共用 snapshot 形成前排除两个会引导通用协作或 Memory
  操作的 official bundled Skill；Runtime 原生 delegation 不属于该 policy 的能力承诺。
- 拒绝第二套执行聚合和 Prompt-only 隔离：前者复制核心生命周期，后者不能成为授权或 terminal route 边界。

<a id="v1-50-d02"></a>
## V1.50-D02：重启取消当前回复，结束不建立 successor cleanup fence

### 背景

为旧 Native Turn 建立专用恢复与 transcript replay 会引入推测性结果和新的产品状态；结束旧会话后等待 Runtime 完全
cleanup，则把 Provider 退出时延错误提升成新 Conversation 的生命周期依赖。

### 决定

App、Core 或 Runtime Host 重启命中的非终态 Single Chat Run 直接按现有取消语义结算，Conversation 保持 active。
只有用户显式结束使 Conversation 变为 ended 并关闭旧私有 route。用户可立即创建同一队员的新 Conversation，不增加
跨 Conversation cleanup fence；所有迟到事件继续按 Run、epoch、Conversation 与 Binding 身份归属旧执行。

### 后果与被拒绝方案

- 不出现 `app_restart`、`recovery_blocked`、旧输入重发、私有摘要恢复或 Native Turn reconcile 产品状态。
- 新 Conversation 不继承旧 transcript、Binding、Session 或公共水位；底层并发限制继续由通用 Scheduler/Fleet 表达。
- 拒绝自动 replay 和 predecessor cleanup 等待，因为两者都无法提供更强的 exactly-once 证明。

<a id="v1-50-d03"></a>
## V1.50-D03：Single Chat 附件复用公共弱持久 Source Ref，不维护私有内容仓库

### 背景

Single Chat 分支最初复制附件到专用私有根并维护独立表、receipt、Runtime projection 与 retention。主线已经把用户附件
简化为弱持久 `LocalAttachmentSourceRef`：选择时记录来源，发送和 dispatch 时重检，必要时才复制到 Run Temp。继续保留
私聊专用内容仓库会产生两套可用性、预览、清理与安全递归规则。

### 决定

Single Chat 全量复用 Camp Source Attachment 的观察、shape/数量验证、可用性重检、execution-root containment、外部来源
Run-local copy、图片准备、预览、打开、Reveal 与 `AttachmentCard`。未发送 refs 存在独立 revision 的
`single_chat_composer_draft`，发送时固定到 `conversation_message.source_attachments_json`。Renderer、History 与模型输入
不暴露原始 `source_path`；不创建 Single Chat 专用文件根、内容副本、retention 或 projection。

### 后果与被拒绝方案

- Camp 公屏与 Single Chat 的唯一所有权差异是 refs 分别归属 `camp_message` 与 `conversation_message`。
- 原文件移动、删除、权限变化或类型变化会诚实变成不可用；内容变化时后续 Run 读取当时实际内容，不承诺快照不可变。
- 拒绝保留私聊专用 copy store 或把 Source Ref 转存到 CampMessage：前者重复公共基础设施，后者破坏私有消息归属。

<a id="v1-50-d04"></a>
## V1.50-D04：运行中的后续单聊输入进入 Conversation-local FIFO，并由失效队首阻塞

### 背景

完全拒绝回复期间的下一条输入会丢失用户已组织的正文与附件；直接在当前 Run 上追加则改变冻结输入。Camp 公屏已有
durable Pending Input、单编辑占用、发布前附件重检和 `needs_repair` 语义，但 Single Chat 不能共享 Camp-wide 队列或把
私聊输入发布为公共消息。

### 决定

同一 Single Chat 有非终态 Run或已有队列时，`singleChat.send` 原子消费 Draft 并创建 Conversation-local Pending Input，
不提前写 ConversationMessage、CampTurn 或 AgentRun。Scheduler 只在该 Conversation 无 active Run、队首为 `queued` 且
无编辑占用时发布；发布沿用原用户身份并原子创建私有 Message/Turn/Run。附件在发布前重新验证，失效队首变为
`needs_repair` 并阻塞同一 Conversation 后续项，直至用户编辑保存或删除。

### 后果与被拒绝方案

- 每个 Conversation 独立 FIFO；一个私聊的 repair、编辑或 active Run 不阻塞 Camp 公屏、其他队员或 successor Conversation。
- 编辑 session 独占，重启后要求显式 takeover；正文与 refs 可保存，附件可添加、移除和重排。
- 拒绝延后读取 Composer Draft、跨 Conversation 队列和“跳过坏队首继续发后项”：它们分别破坏发送时快照、身份隔离和
  用户可见顺序。
