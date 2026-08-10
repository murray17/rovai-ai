---
document_type: renderer-contract
contract: run-process-detail-surface-v2
authority: agent-level-continuous-execution-process-surface
status: accepted
last_updated: 2026-08-10
---

# Run Process Detail Surface v2（Agent 级连续过程）

本合同约束 Arctic Dawn Camp 会话区的 Agent 级执行过程。它替代
[Run Process Detail Surface v1](run-process-detail-surface-v1.md) 的逐 `AgentRun` 选择；v1 保持
历史语义，不作为当前 Renderer 入口。视觉 Token、导航、Composer、Approval、响应式和无障碍基础
继续以 [Arctic Dawn V3](../ui/arctic-dawn.md) 为准。领域对象和证据权威仍属于 Core；本合同不创建
新的 Process 数据模型。

## 1. Agent 过程 read model

当前 Camp Snapshot 中，每个至少有一条 `AgentRun` 的 `agentId` 对应恰好一个 Agent 过程。过程仅由
同一 Camp、同一 `agentId` 的 Run 分组：不得按 Task、CampTurn、Delivery、时间相邻、正文或语义相似度
扩展或缩小分组。该过程没有持久化 ID、Core 表、IPC、命令、写权限、兼容 reader 或独立审计事件。

过程入口按当前 CampMember `memberOrder` 升序显示，未知成员以 `agentId` 作稳定 fallback。每位队员只有
一个可访问的入口，包含身份、名称、“执行过程”和本地化状态；不得回退到逐 Run chip、`N 个执行`、
`N 条投递`或另一条活动时间线。一个过程的摘要状态从其 newest-first Runs 中按以下优先级选择：

```text
最新 running Run
  -> 最新 queued / waiting / 其他 non-terminal Run
  -> 最新 terminal Run
```

该优先级只服务显示与初始定位，不能改变 Run 状态、调度、Delivery、CampTurn 或证据。

## 2. 会话区与过程详情

```text
Camp Header（待审批摘要 + Inspector 显隐；不提供执行入口）
公共消息时间线
  └─ Agent 执行台（每位队员一个过程入口）
  └─ Execution Drawer（按需；所选 Agent 的连续 Run stage）
Approval Dock（紧贴 Composer 上方）
Composer（发送 / 活跃 CampTurn 时唯一 Stop）
```

Agent 执行台和 Execution Drawer 位于会话阅读流之后、Approval Dock 之前。它们不自动滚动消息时间线，
不抢焦点，也不形成第二条聊天或审计时间线。无 AgentRun 时两个 surface 都不渲染。

Drawer 的选择 identity 为 `agentId`，并以有标题的非模态 `region` 呈现。打开一个过程时，系统定位
第 1 节定义的 preferred Run，并将其 stage 滚动到可视区；只有该 stage 可以默认展开 live disclosure。
同一 Agent 的 Runs 以创建时间升序排列，每一 stage 明确展示：本地化时间区间、AgentRun ID、CampTurn ID、
调用来源、A2A 深度（适用时）、Run 状态、Delivery 收件人和 Execution Evidence disclosure。每个 Run
继续独立读取其真实证据；不得拼接、删减或把多个 Run 伪装为一次执行。Message Delivery 状态标签不在
会话 footer 或 Run stage 重复投影；底层 Delivery、ContextManifest 与审计事实保持原有 Read Side 边界。

后台事件不得自动打开 Drawer、改选 Agent、改选 stage、滚动会话或抢焦点。已打开过程只在用户关闭、选择
其他 Agent 或切换 Camp 时改变。关闭按钮和焦点位于 Drawer 内时的 `Escape` 均关闭该 region 并把焦点
返回原触发入口；Drawer 不使用 backdrop 或 focus trap。

Task 的 Related execution 与停止结果的“结果待确认”都按 Agent 打开过程，不保留 Run-ID-only Drawer
route/state。它们不会从 Task 或 CampTurn 推断新的过程成员关系。Camp Header 不再提供另一条执行入口。

## 3. Inspector、Stop 与 Approval layering

Inspector 只保留：

```text
任务 | 上下文投递 | 审批
```

不得保留 Activity/Audit Tab、空白占位、旧 URL、独立 Renderer state、Activity/Audit 专属 IPC 或将
过程 stage 复制为审计列表。证据与审计事实继续附着于其现有 Core Read Side；它们不会因删除 Tab 而被删除。

- 活跃 CampTurn 时，Composer 的发送位置是唯一 danger Stop，fence 当前 CampTurn 的整棵
  AgentRun/Message Delivery 执行树；不引入 Agent 或 Run 级 stop/cancel/retry；
- Camp Header、Agent 执行台、Drawer、每个 stage、Inspector、Task 详情和公共消息不得渲染另一 Stop；
- Approval Dock 立即位于 Composer 上方，保持非模态、可聚合和键盘可操作；当空间不足时过程详情滚动、
  收起或退化为摘要，不能遮挡 Dock、Composer 或唯一 Stop；
- Stop 处理期间草稿编辑和导航保持可用，权威 CampTurn 状态返回后才更新过程状态。

## 4. 可访问性与适配

- Agent 执行台使用 `list` / `button` 语义；每个入口有队员、过程和状态的可读名称，selected 状态可访问；
- Drawer 使用具名 `region`；视觉、Tab 与 DOM 顺序一致；不使用 `aria-live` 逐字播报 Runtime 流式日志，
  仅播报状态变化；
- Drawer、Approval Dock、Composer 和唯一 Stop 在 200% zoom 下都可达且互不遮挡；
- 沿用 `1440×920` 基准和最小 `1040×700`。Inspector 隐藏时过程 surface 不得导致时间线横向滚动；
- `prefers-reduced-motion` 下关闭滑入、脉冲和滚动动画，但不改变 running Run 默认展开行为，并保留
  文字和图标状态。

## 5. 数据边界

Agent 过程只消费当前 Camp 的 Core Snapshot、Canonical Runtime Activity、Execution Evidence、Delivery
收件人和当前 CampMember identity/order。它不读取、推断或写入其他 Camp；不创建
demo Agent、假 Runtime、布局切换、Activity/Audit Inspector、Run/Agent Stop 或“自动打开”生产 schema、IPC
或领域命令。HTML 原型只能说明层级，不能成为数据源或覆盖本合同。
