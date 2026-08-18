---
document_type: architecture
authority: notification-episode-architecture
status: accepted
last_updated: 2026-08-14
---

# Notification Episode 架构

## 组件关系

```text
CampMessage / CampTurn / Approval source transaction
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
  ├─ clear() ────────────── through attention revision
  └─ markAllRead() ──────── through global change sequence

Electron Main ── allowlisted JSON-RPC adapter only
Renderer Attention Controller
  ├─ lightweight unread high-water baseline
  ├─ exact Change Journal signal queue + invalidation
  ├─ foreground-only transient heads-up
  └─ exact visible-source acknowledgement
```

Core SQLite 是唯一持久真源。source transaction 的任一写入失败都会回滚 Occurrence、Episode 与 Journal；
Electron Main 和 Renderer 不保存副本或聚合状态。`event_log` 可以促使刷新，但通知游标只来自 Journal。

## 深模块 seam

外部 interface 只暴露六个通知行为和 preference。聚合、原因优先级、逐 Mention 选择、approval generation、
版本/注意力 revision、clear reappearance、Journal floor 和 hydration 全部隐藏在 Core module 内；同一
interface 也是测试面。SQLite triggers 是该 implementation 的 source adapters，不成为 Renderer interface。

Clear 以前的 Occurrence 继续是不可变历史事实，但 Core 以
`admittedAttentionRevision > clearedThroughAttentionRevision` 建立 Active Attention seam。未读、当前原因计数、
attention action、heads-up eligibility 与 retention 活跃性只看 Active Attention；历史标题和历史总数不被
Clear 改写。

## Read hydration

持久 Episode 不复制展示数据。Core 在 read transaction 中连接当前 Camp、CampTurn、Approval、CampMessage
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
`messageId/campTurnId`，以及实际展开可见的 pending `approvalId`。Core 的
`acknowledgeVisibleSources()` 再以当前用户、Camp、Active Attention 与 Renderer 已观察 Journal high-water
交叉验证并原子确认；因此普通导航可以自然消角标，但屏幕外来源和边界后新到达的通知不会被顺带读掉。
Episode 推荐动作从不参与该来源集合。

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
- Renderer 分页使用局部 candidate cursor；所有分页、精确可见性处理、Inbox 接收和 heads-up 入队成功后
  才提交共享 cursor，失败保持原边界重试。
- Renderer 按 Journal 顺序先归约 exact invalidation、再接收同 change 的新 signal；普通 Inbox hydration
  不改变临时队列，reset/重新建立 baseline 时直接清空且不从 Episode actions 恢复。
- 只有 `notification_episode.changed` 精确信号触发增量读取；其他 Core event 不触发通知扫描，30 秒恢复
  轮询与窗口重新聚焦只用于丢事件、休眠和暂时失败后的收敛。
- 应用失焦或不可见时 exact signal 仍可进入内存队列，但浮层不挂载、不开始 8 秒计时；重新获得注意后
  才显示。队列不是持久状态，reset/重新建立 baseline 时清空。
- 可见来源确认 applied 后只重读轻量未读状态；失败保持未读并在来源仍可见时退避重试。

## 保留

Journal 可以独立截断并提升 floor。Episode 只有在所有来源终结后才进入数量/时间回收候选；可重新出现的
Episode 不因 clear 一天而删除；Clear 覆盖的历史未确认来源不再阻止终结 Episode 回收。删除 Episode 前写 remove change，Camp aggregate 删除则由同一事务级
cascade 和 Journal trigger 收口。

## References

- [通知事实与投影](foundational-invariants.md#core-notifications)
- [Notification Episode v4](../contracts/notification-episode-v4.md)
- [Current User Attention v4](../contracts/current-user-attention-v4.md)
