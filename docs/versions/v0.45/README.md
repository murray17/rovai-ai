---
document_type: version-overview
version: v0.45
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-08
---

# Rovai-ai v0.45：显式 A2A 与公共输出重构

> 设计状态：已确认。实现状态：完成。Public A2A、统一 Message Delivery、Profile v2、
> Runtime public output boundary、Renderer Scheme C 和 clean-break migration 已交付；Rust/
> TypeScript 验收、recovery/intake smoke、Runtime Activity/Structured Mention UI 验收及
> macOS arm64 打包签名均已通过。
>
> 前置版本：[v0.44 确定性原始公共上下文](../v0.44/README.md)
>
> 主要决策：[ADR-0130](../../adr/0130-public-a2a-message-and-unified-delivery.md)、
> [ADR-0131](../../adr/0131-recipient-scoped-event-driven-delivery-recovery.md)、
> [ADR-0132](../../adr/0132-public-reference-context-closure-profile-v2.md)、
> [ADR-0133](../../adr/0133-scheme-c-run-process-detail-surface.md)、
> [ADR-0134](../../adr/0134-runtime-public-output-boundary.md)

## 版本目标

v0.45 把 RovAI 从“AgentRun 完成后产生一条总结消息”的单输出模型改为公共消息优先的
A2A 模型：

- Agent 使用 `camp.message.send`（CLI：`rovai send`）提交一条真正进入 Camp 公共消息区的
  Public A2A Message；它对用户、当前有权查看该 Camp 的成员、公共历史和搜索可见；
- 一条消息统一产生 `0..N` 个 Message Delivery。公共消息事实只有一个，收件人专属的
  队列、尝试、等待、目标 Run 和终态全部由 Delivery 负责；不再建立私有 A2A 消息、
  `CampMessageRecipient`、`AgentMessageDelivery` 或第二套 `ConversationInput` 投递路径；
- `--to`、正文内严格的 `@agent_id` Addressing Token 和 reply-to 默认目标在 Core 统一解析。
  解析失败整笔拒绝，并把全部错误一次返回给当前 Agent；修正后必须使用新的
  `requestId`；
- Effective Recipients 去重后按规范化 Agent ID 的 UTF-8/ASCII 字节序升序冻结。该顺序只
  服务身份、Envelope、幂等、审计和重试，不表达调度优先级；
- Delivery 对 Runtime 不可用、目标忙或容量不足采用 recipient-scoped 事件驱动 pump。
  首次 dispatch attempt 尚未建立时崩溃的 Delivery 标记为
  `interrupted_before_dispatch`，重启和 Camp 级事件不能隐式复活；
- Runtime Adapter 明确声明 `explicit_send_only` 或 `assistant_final_visible`。只有可靠的
  final boundary 才能把 recipient-free 的最终输出自动写成公共消息；同一 Run 的完全相同
  规范化正文才允许精确抑制重复（已由 Runtime completion fence 与 exact digest regression
  fixture 覆盖）；
- Public Reference Context Closure 采用 Profile v2 的最多 3 条直接父链引用。引用链、公共
  历史和 omission 共享确定性字符预算，ContextManifest 冻结选择与 ACK 证据；直接父消息
  无法在保留当前输入和必需结构后容纳时，Delivery 在 AgentRun 物化前终态失败；
- 采用 Scheme C 会话区：Run Pulse 常驻摘要，Execution Drawer 按需查看和选择 Run；Drawer
  只读过程详情，不提供 Run 级停止。Inspector 删除“活动”页，CampTurn 停止仍只占用
  Composer 的发送位置，并 fence 整棵 AgentRun/Message Delivery 执行树；
- 这是上线前 clean break。无需兼容老数据或旧 `team.call_member` 私有投递记录；Migration
  可以清理 Rovai-owned app data，但不能删除用户工作区或 Runtime 外部状态。

## 核心范围

### 公共消息与投递

`CampMessage` 是公共事实，至少保存作者、正文、`replyToCampMessageId`、冻结的
`effectiveRecipients` 和展示元数据。每个有效收件人得到一个独立 Message Delivery；公共-only
消息没有 Delivery。Delivery 创建与消息提交在同一 Core 事务中完成，之后由唯一的 Message
Delivery Dispatch Pump 负责排队、投递、重试和目标 Run 关联。

### 寻址、幂等与预算

正文 Token 只在可解析正文区域识别：严格匹配当前 Camp 有效 Agent ID 的 `@agent_id` 才会
寻址；转义、代码、URL 和普通 `agent_id` 文本保持字面。显式目标、inline token 和 reply-to
默认目标取并集，任何一个无效目标都使整笔请求 fail closed。单次 fanout 受当前 CampTurn
剩余 A2A 额度与产品绝对上限 16 的双重约束，超限不产生部分消息。A2A lineage 最大深度为
5，禁止自环和祖先环。

幂等只认同一执行身份下相同 `requestId` 与相同 canonical input；同 requestId 不同输入返回
冲突。不存在按正文相似度、时间窗或收件人集合的语义去重；Delivery 手动重试使用独立的
Retry Identity，但复用原始冻结快照。

### 动态上下文

Profile v2 冻结 15 条、24,000 Unicode scalars、单条 2,000 scalars 和
`maxPublicReferenceChainMessages: 3`。当前输入始终完整。回复 Agent-authored Public
A2A Message 时，直接父消息和最多两条更远父链可进入 Closure；不会因为某条消息的引用再递归
扩展无关历史。Closure 不创建新消息或 Delivery，也不改变 Accepted Public Context Boundary。

### 会话区与停止权威

现有 Arctic Dawn App Shell、Token、导航、Composer、Approval Dock、Inspector 的 Tasks/Context/
Approvals/Audit 页和无障碍合同继续有效。新增或调整的只有会话区关键层级：Run Pulse、按需
Execution Drawer、公共消息的 Run-origin 入口与 Delivery 状态投影。原型 HTML 的示例数据、
右侧 Activity 页、独立 Run 停止按钮和原型专用顶部工具条不是产品合同。

## 明确不在 v0.45

- 不保留 `team.call_member` / `rovai member call` alias、私有 A2A 消息或旧数据回填；
- 不引入 Run 级取消协议、Drawer 内停止按钮或 Camp 级“继续待处理协作”兜底扫描；
- 不以 Core/App 启动、Camp 打开、新消息或任意 Camp 级事件批量恢复 Delivery；
- 不删除 Profile v2 的最多 3 条 reference chain 限额，也不把 Closure 扩展成无限公共历史；
- 不让 `--to`、inline token 顺序或 canonical Agent ID 排序决定 Scheduler 优先级；
- 不把公共 A2A 的关系链误当作回复 obligation、结果回传槽位或自动闭环；
- 不把 HTML 原型的视觉 token、侧栏、Inspector Activity 页或演示数据复制进生产实现。

## 交付证据要求

实现完成前，版本不能标记为 complete。至少需要：

1. Core 事务、Addressing Token 解析、严格错误、canonical recipient、幂等、fanout 和 lineage
   的 Rust fixture 与集成测试；
2. Message Delivery 状态机、recipient-scoped pump、崩溃窗口、显式 retry/cancel、Context
   gate 和 Manifest/ACK 的恢复矩阵；
3. Runtime Adapter 两种输出模式、同 Run 精确 final suppression 与公共消息可见性/search
   回归；
4. Renderer/Preload/IPC 的 Scheme C、Run Pulse/Drawer、Approval Dock、CampTurn Stop 和
   Inspector Activity 删除的键盘、焦点、响应式及打包 App 验收；
5. clean-break Migration、旧私有路径/文案/类型静态扫描，以及 Rust、TypeScript、Renderer、
   Migration、打包和真实 Runtime smoke 全部通过。

实施顺序、验收证据与 clean-break migration 记录见[实施与验收计划](implementation-plan.md)。
