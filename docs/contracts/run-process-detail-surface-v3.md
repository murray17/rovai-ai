---
document_type: renderer-contract
contract: run-process-detail-surface-v3
authority: agent-level-continuous-execution-process-and-focused-inspector-surface
status: accepted
last_updated: 2026-08-11
---

# Run Process Detail Surface v3（Agent 级连续过程与聚焦 Inspector）

本合同以 [Run Process Detail Surface v2](run-process-detail-surface-v2.md) 的 Agent 级连续过程为
基础，替代其三 Tab Inspector 和重复 Approval surface；v2 保持历史语义，不作为当前 Renderer
入口。视觉 Token、导航、Composer、Approval、响应式和无障碍基础继续以
[Camp 会话工作区](../ui/components/conversation-workspace.md) 为准。领域对象和证据权威仍属于 Core；本合同不创建新的
Process、Team 或 Approval 数据模型。

## 1. Agent 过程 read model

当前 Camp Snapshot 中，每个至少有一条 `AgentRun` 的 `agentId` 对应恰好一个 Agent 过程。过程仅由
同一 Camp、同一 `agentId` 的 Run 分组：不得按 Task、CampTurn、Delivery、时间相邻、正文或语义相似度
扩展或缩小分组。该过程没有持久化 ID、Core 表、IPC 命令、写权限、兼容 reader 或独立审计事件。

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
Approval Dock（紧贴 Composer 上方；唯一普通审批决策 surface）
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

用户显式发送消息且 Core 接受本次 CampTurn 后，Renderer 可以用该命令回执中的有序
`agentRunIds` 做一次性定位：如果用户当前没有正在查看 non-terminal AgentRun，则打开列表中第一条 Run
所属 Agent 的唯一过程入口，并聚焦这条精确 Run stage；如果已经聚焦任意 `queued / running / waiting`
Run，则保留当前过程，不因新提交切换。该定位只改变可见过程，不移动 DOM 焦点，Composer 继续保持键盘
上下文。回执尚未进入 Snapshot 时可以等待同一 CampTurn 的 Run 出现，但切换 Camp 后必须丢弃等待状态。

除上述“当前用户显式发送成功”外，后台 A2A、Runtime/Read Side 事件、重载、恢复和重进 Camp 均不得
自动打开 Drawer、改选 Agent、改选 stage、滚动公共消息时间线或抢焦点。已打开过程只在用户关闭、选择
其他 Agent、上述一次性发送定位或切换 Camp 时改变。关闭按钮和焦点位于 Drawer 内时的 `Escape` 均关闭
该 region；有真实触发入口时把焦点返回原入口，自动打开不伪造焦点返回目标。Drawer 不使用 backdrop 或
focus trap。

聚焦 non-terminal Run 时，Drawer 内部采用 sticky-bottom 跟随：用户仍停留在底部阈值内时，新公开叙述、
计划、Tool Call 和状态更新到达后滚动到最新输出；用户向上滚动离开底部后立即暂停，回到底部后恢复。
如果仍处于跟随状态，Run 的终态更新和最后一批输出只完成一次末尾定位，随后停止自动跟随。该机制不得
滚动公共消息时间线，也不得用 `aria-live` 逐字播报 Runtime 流式内容。

Drawer 顶边提供唯一的水平 resize separator。向上拖拽扩大、向下拖拽缩小；调整值只保存在当前 Main
Window Session，不进入 Core、Camp、AgentRun 或持久偏好。切换 Agent、收起后重开或离开 Camp 再返回时
沿用该会话值，Enter、Space 或双击 separator 恢复响应式默认高度。Renderer 必须根据当前会话列真实可用
高度限制上下界，并始终为公共消息时间线、Agent 执行台、Approval Dock 与 Composer 留出可达空间；窗口
缩小时只对显示高度作 clamp，不改写 Agent/Run 选择。调整高度时，正在 sticky-bottom 跟随的 Run 继续定位
最新输出，手动上滚后仍保持原阅读位置。

Task 的 Related execution 与停止结果的“结果待确认”都按 Agent 打开过程，不保留 Run-ID-only Drawer
route/state。它们不会从 Task 或 CampTurn 推断新的过程成员关系。Camp Header 不再提供另一条执行入口。

## 3. Inspector、Lead、Stop 与 Approval layering

Inspector 只保留：

```text
任务 | 队员
```

不得保留 Context Delivery、Approval、Activity 或 Audit Tab、空白占位、旧 URL、独立 Renderer state、
专属 IPC 或重复过程 chronology。删除可见 Tab 不删除任何权威 Read Side、ContextManifest 或审计事实。

- “任务”继续读取当前 Task 权威状态，并保留既有 list/detail/editor/conflict/related-execution 行为；
- “队员”只显示当前 Camp 的 active、profile-not-removed CampMember，按 `memberOrder` 排序，并读取真实
  identity、team role、presence、Runtime readiness 与 Default Lead；
- “队员”页是唯一 Camp-local Lead 控制，继续提交 versioned `camps.changeDefaultLead`；只有 active、
  `profilePresence = present` 且 `leaveRequestedAt = null` 的队员可选；
- ContextManifest、Context Delivery Profile 与 Runtime Input Delivery Evidence 继续由 Core/Snapshot
  保留，但不进入 ordinary Inspector；
- Approval Dock 是唯一 ordinary pending-Approval 决定 surface。Header 与通知摘要只展开、定位并聚焦
  Dock，不改变 Inspector 显隐或页签；Dock 收起不改变队列，最后一项解决后焦点返回 Composer；
- 活跃 CampTurn 时，Composer 的发送位置是唯一 danger Stop，fence 当前 CampTurn 的整棵
  AgentRun/Message Delivery 执行树；不引入 Agent 或 Run 级 stop/cancel/retry；
- Camp Header、Agent 执行台、Drawer、每个 stage、Inspector、Task 详情和公共消息不得渲染另一 Stop；
- Stop 处理期间草稿编辑和导航保持可用，权威 CampTurn 状态返回后才更新过程状态。

## 4. 可访问性与适配

- Agent 执行台使用 `list` / `button` 语义；每个入口有队员、过程和状态的可读名称，selected 状态可访问；
- Drawer 使用具名 `region`；视觉、Tab 与 DOM 顺序一致；不使用 `aria-live` 逐字播报 Runtime 流式日志，
  仅播报状态变化；
- Drawer resize handle 使用可聚焦的水平 `separator` 和 `aria-valuemin / aria-valuemax / aria-valuenow`；
  上/右方向键扩大、下/左方向键缩小，PageUp/PageDown 大步调整，Home/End 到达边界，Enter/Space
  恢复默认；指针拖拽与键盘不得改变当前 AgentRun、抢走 Composer 焦点或触发执行命令；
- 显式发送后的自动定位不得夺走 Composer 焦点；sticky-bottom 在手动上滚后暂停，不能与键盘阅读历史争夺
  滚动位置；
- Inspector 使用完整 `tablist / tab / tabpanel` 语义和手动激活；Lead picker 使用可访问的单选菜单，
  暂离和不可选状态不得只依赖颜色；
- Header/通知定位 Approval 时，Dock 必须先展开再把键盘焦点移到可决定选项；
- Drawer、Approval Dock、Composer 和唯一 Stop 在 200% zoom 下都可达且互不遮挡；
- 沿用 `1440×920` 基准和最小 `1040×700`。Inspector 隐藏时过程 surface 不得导致时间线横向滚动；
- `prefers-reduced-motion` 下关闭滑入、脉冲和滚动动画，但不改变 running Run 默认展开、Dock 定位或
  Lead 选择语义。

## 5. 数据边界

Agent 过程和聚焦 Inspector 只消费当前 Camp 的 Core Snapshot、当前用户发送命令的既有结果回执、
Canonical Runtime Activity、Execution Evidence、Delivery 收件人、Task、CampMember 与 AgentProfile。
Renderer 不读取、推断或写入其他 Camp，不创建 demo Agent、假 Runtime、布局切换、旧 Inspector Tab、
Run/Agent Stop、第二套 Approval queue 或本地 Lead authority。HTML 原型只能说明层级，不能成为数据源
或覆盖本合同。
