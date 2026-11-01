---
document_type: architecture
authority: notification-episode-architecture
status: accepted
last_updated: 2026-10-21
---

# Notification Episode 架构

## 组件关系

```text
ThreadMessage / AgentRun / Delivery / Mission / Task / Approval source transaction
  └─ Notification write projection
       ├─ immutable Occurrence
       ├─ mutable Occurrence Disposition
       ├─ materialized Episode identity + revisions
       └─ minimal Change Journal entry + exact heads-up invalidation facts

Core Notification module
  ├─ inbox() ────────────── current hydrated Episode views
  ├─ changesSince() ─────── journal identities + current Episode + exact signal hydration
  ├─ acknowledge() ──────── one observed occurrence
  ├─ acknowledgeVisibleSources() ─ exact visible sources through observed journal boundary
  ├─ threadInterruptions() ─ bounded per-Thread interruption projection
  ├─ acknowledgeThreadInterruptions() ─ observed Thread interruption candidates only
  ├─ clear() ────────────── through attention revision
  └─ markAllRead() ──────── through global change sequence

Electron Main ── allowlisted JSON-RPC adapter only
Renderer Attention Controller
  ├─ lightweight unread high-water baseline
  ├─ exact Change Journal signal queue + invalidation
  ├─ foreground-only transient heads-up + attentive active-Thread quiet scope
  └─ exact visible-source acknowledgement
```

Core SQLite 是唯一持久真源。source transaction 的任一写入失败都会回滚 Occurrence、Episode 与 Journal；
Electron Main 和 Renderer 不保存副本或聚合状态。`event_log` 可以促使刷新，但通知游标只来自通知时钟与 Journal。

## 深模块 seam

外部 interface 暴露通知读取、处置与 preference；中断候选和范围确认由同一通知模块拥有。聚合、原因优先级、逐 Mention 选择、approval generation、
版本/注意力 revision、clear reappearance、Journal floor 和 hydration 全部隐藏在 Core module 内；同一
interface 也是测试面。SQLite triggers 是该 implementation 的 source adapters，不成为 Renderer interface。

Clear 以前的 Occurrence 继续是不可变历史事实，但 Core 以
`admittedAttentionRevision > clearedThroughAttentionRevision` 建立 Active Attention seam。未读、当前原因计数、
attention action、heads-up eligibility 与 retention 活跃性只看 Active Attention；历史标题和历史总数不被
Clear 改写。

## Read hydration

持久 Episode 不复制展示数据。Core 在 read transaction 中连接当前 Thread、ThreadTurn、AgentRun、Approval、ThreadMessage
与 AgentProfile，生成 closed `primarySemantic`、reason counts/states、message summary、current display name
和 typed actions。来源不存在或 tombstoned 时 action `available=false`；Episode identity 与用户 disposition
仍保留。标题/显示名/availability 改变不会写 Journal 或增加 attention revision。

Journal 行的 heads-up reason 只用于 Core 定位同一 `admittedChangeSequence` 的 Occurrence。`changesSince`
为该 change 单独水合 exact HeadsUpSignal；Renderer 的浮层文案、点击和确认只消费 signal，不能复用当前
Episode primary fields。Approval Read Side 先选择仍 pending 的 Active Attention；只剩 resolved 未确认来源
时返回不导航的 `acknowledge_only`。

Journal 另外保存 disposition change 的精确 acknowledgement identity 与 Clear 的实际 attention revision
边界，并投影 closed heads-up invalidation。resolved Approval 仍可保持 Active Attention，但已退出 Heads-Up
Eligible Attention；其旧 pending signal 按 identity 失效。Episode `primaryAction + secondaryActions` 只是
推荐/展示动作，不是全部 attention identity 的索引。

会话区是可见性传感器，不拥有通知集合。它只在前台“会话”视图中收集与时间线视口相交的
`messageId/threadTurnId/agentRunId`，以及实际展开可见的 pending `approvalId`。Core 的
`acknowledgeVisibleSources()` 再以当前用户、Thread、Active Attention 与 Renderer 已观察 Journal high-water
交叉验证并原子确认；因此普通导航可以自然消角标，但屏幕外来源和边界后新到达的通知不会被顺带读掉。
Episode 推荐动作从不参与该来源集合。执行台由稳定 Portal 在底部、Inspector 与右侧宿主间移动，AgentRun
观察和定位以该 Portal 为边界；右侧宿主位于会话根节点之外，不能退回以会话 DOM root 推断可见性。

临时浮层另有 Renderer-local quiet scope：窗口可见且有焦点、Thread workspace 是当前产品 surface 时，同 Thread
的所有语义 signal 在 Journal 归约中不入队，已在队列中的同 Thread signal 也移除且不在离开后重放。该策略只改变
瞬时呈现，不进入 `acknowledgeVisibleSources()` 输入，不写 Disposition，也不清除未读；其他 Thread、其他页面或
失焦窗口仍沿用 preference、队列与暂停计时。

持久通知中心、全局通知入口和未读总数徽标当前不进入生产 Renderer。Core 的 Episode/Occurrence/Journal
与命令保持不变；Renderer 只保留轻量 Attention Controller、临时 heads-up 和会话导航未读点，避免为了
隐藏 surface 持续水合完整 Inbox。

## 并发和恢复

- 每个 attention-worthy source 先获得全局 change sequence，再以同一边界写 Occurrence 与 Journal；
- action/acknowledgement 绑定 observed Episode version，clear 绑定 attention revision，mark-all 绑定
  change sequence；
- Inbox cursor 包含首次读取 high-water；Journal cursor 早于 retained floor 时要求 reset；
- App/Renderer 启动以 unread `limit=1` 读取 Inbox high-water 与未读布尔事实，历史未读不形成 heads-up；
  运行中只消费之后的 Journal。
- Task 开关采用设置事务内固定、持久化的通知边界。变化时递增已有通知时钟，空序号不产生通知事实或未读。
  changesSince 同一事务返回增量和有效 Task 快照；Renderer 与设置共用按序号更新的能力投影，隔离迟到响应。
  不等待设置读取、不另读水位，不回退或直接重置全局消费游标。见 [Notification Episode v12](../contracts/notification-episode-v12.md)。
- Renderer 分页使用局部 candidate cursor；所有分页、精确可见性处理、Inbox 接收和 heads-up 入队成功后
  才提交共享 cursor，失败保持原边界重试。
- Renderer 按 Journal 顺序先归约 exact invalidation、再接收同 change 的新 signal；普通 Inbox hydration
  不改变临时队列，reset/重新建立 baseline 时直接清空且不从 Episode actions 恢复。
- 只有 `notification_episode.changed` 精确信号触发增量读取；其他 Core event 不触发通知扫描，30 秒恢复
  轮询与窗口重新聚焦只用于丢事件、休眠和暂时失败后的收敛。
- 应用失焦或不可见时 exact signal 仍可进入内存队列，但浮层隐藏并暂停剩余 8 秒计时；重新获得注意并收敛失效来源后
  才显示。队列不是持久状态，reset/重新建立 baseline 时清空。
- 可见来源确认 applied 后只重读轻量未读状态；失败保持未读并在来源仍可见时退避重试。

## 保留

Journal 可以独立截断并提升 floor。Episode 只有在所有来源终结后才进入数量/时间回收候选；可重新出现的
Episode 不因 clear 一天而删除；Clear 覆盖的历史未确认来源不再阻止终结 Episode 回收。删除 Episode 前写 remove change，Thread aggregate 删除则由同一事务级
cascade 和 Journal trigger 收口。

## References

- [通知事实与投影](foundational-invariants.md#core-notifications)
- [Notification Episode v12](../contracts/notification-episode-v12.md)
- [Current User Attention v10](../contracts/current-user-attention-v10.md)


## 公屏与单聊注意力

本机 Owner 通知通过精确 Run 的冻结目的地标识单聊，审批从 Action / Run 解析；不把 Thread ID 当作私有
阅读身份。单聊的终态摘要与审批 Dock 回报精确可见来源，公屏在单聊面板打开时停止回报可见来源。
当前前台 Thread workspace 对全部临时卡片保持静默，已读仍要求实际可见内容。Migration 146 限定完成 satisfaction 的对话
范围，单聊结束按原 Occurrence invalidation 撤回队列。卡片只包含来源与信息，剩余提醒由轻入口按需查看。

Delivery-first batch Run 由 Migration 164 增加 `agent_run` Occurrence source；不创建 ThreadTurn。Renderer 的
`open_agent_run` 动作先打开对应承载位置，再选择成员并定位 exact Run；右侧位置显式打开 Execution 标签，紧凑
布局保留该目标面板。只有 Portal 内该执行节点实际可见才回报确认。


## 本轮与业务状态来源

[Notification Episode v9](../contracts/notification-episode-v9.md) 由全部消息输入和产出关联形成通知专属图。
`notification_round` 只记录成功结算的连通分量与相关 Run，不参与 claim、预算、权限或 Context。
Run 成功、Delivery 结算和消息发布都可触发检查；waiting/claimed 或任何非成功分支阻止成功提醒。
`notification_round_probe` 是同事务触发入口，提交时为空，不是后台队列。旧 ThreadTurn 终态 producer 退出，
历史 Occurrence 保留；新 Single Chat 回复使用私有最终消息与原 Conversation/Run。

Mission/Task command 的真实状态变化同事务调用通知 source adapter；同状态、只改 sourceMessageId 和用户自己的
状态操作不新增通知。Mission 离开 needs_you 会通过 Disposition 解决旧问题，问题文本只水合显式消息正文。
偏好与状态筛选只控制瞬时呈现；按相同 sourceMessageId、完成状态 actor Run 与已完成图成员关系合并重复卡片。
当前 Mission/Task 标题在读取时水合，原状态与来源仍是不可变事实。新回复小点另由非撤回 Agent 消息首次发布水位
决定，与终态成功或精确通知确认独立。

<a id="中断蓝点与实时反馈"></a>
<a id="app-退出中断提醒"></a>
## 执行中断提醒

[Notification Episode v12](../contracts/notification-episode-v12.md) 沿用退出和启动恢复的真实终态事务，
仅将 `app_shutdown` / `execution_lost` 作为侧栏执行中断提醒；App 运行期间确认 Host/worker 丢失同样属于后者。
既有恢复仍可继续的执行不造中断；
手动停止不再准入停止通知。旧 `user_stop` 历史事实退出侧栏候选，保留原 Disposition 审计。
Migration 210 / schema 160 原子替换 producer，不回填、不新增运行记录或恢复扫描。

Thread 批量投影从请求 ID 和中断部分索引读取，使用绑定已准入 Database 的独立只读 WAL 事务，
不水合 Inbox 正文。确认仍走原写连接和 Gateway，同一 Disposition 是唯一已读真源。
已结束私有 Conversation 退出候选，不让后继单聊代读。每批立即接收；失败/挂起不拖住其他批
或后续刷新，代次、已知序号和确认回执隔离迟到响应。

正常增量只由通知事件驱动，空批次不读投影。初始化、导航范围变化、reset、重新聚焦及既有
30 秒恢复轮询用于收敛。普通执行进度、消息快照更新不能重启通知轮询；稳定 dispatcher 读取当前来源。
读取中收到信号只保留一次待刷新及其恢复意图，完成后补读；失败保持退避，停用/卸载取消补读。
没有短亮准入描述、停止意图、展示计时和状态槽检测。

前台正式 Thread 内容成功展示后，按已加载的当前代次投影冻结边界，以范围命令确认执行中断提醒。
这一提醒表示会话执行被打断，因此不再要求定位具体 Run 或输出；工作区挂载条件与确认条件共用，
使命记录未就绪及缓存/失败内容不确认。排队回调执行时再次核对代次，不能用旧快照抢先记为已查看。
其他通知仍使用精确可见来源，包含无输出普通失败的可见气泡；`acknowledgeVisibleSources` 排除中断分类。
显式标记已读先保存本机状态，再确认冻结范围；Core 重试不重做本机操作。
取舍见 [V1.72-D55](../versions/v1.72/decisions.md#v1-72-d55)。
