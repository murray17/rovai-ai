---
document_type: architecture
authority: notification-episode-architecture
status: accepted
last_updated: 2026-08-13
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
  ├─ clear() ────────────── through attention revision
  └─ markAllRead() ──────── through global change sequence

Electron Main ── allowlisted JSON-RPC adapter only
Renderer ─────── localization, layout, exact typed action execution
```

Core SQLite 是唯一持久真源。source transaction 的任一写入失败都会回滚 Occurrence、Episode 与 Journal；
Electron Main 和 Renderer 不保存副本或聚合状态。`event_log` 可以促使刷新，但通知游标只来自 Journal。

## 深模块 seam

外部 interface 只暴露五个通知行为和 preference。聚合、原因优先级、逐 Mention 选择、approval generation、
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

## 并发和恢复

- 每个 attention-worthy source 先获得全局 change sequence，再以同一边界写 Occurrence 与 Journal；
- action/acknowledgement 绑定 observed Episode version，clear 绑定 attention revision，mark-all 绑定
  change sequence；
- Inbox cursor 包含首次读取 high-water；Journal cursor 早于 retained floor 时要求 reset；
- App/Renderer 启动先读取 Inbox high-water，历史未读不形成 heads-up；运行中只消费之后的 Journal。
- Renderer 分页使用局部 candidate cursor；所有分页、精确可见性处理、Inbox 接收和 heads-up 入队成功后
  才提交共享 cursor，失败保持原边界重试。
- Renderer 按 Journal 顺序先归约 exact invalidation、再接收同 change 的新 signal；普通 Inbox hydration
  不改变临时队列，reset/重新建立 baseline 时直接清空且不从 Episode actions 恢复。

## 保留

Journal 可以独立截断并提升 floor。Episode 只有在所有来源终结后才进入数量/时间回收候选；可重新出现的
Episode 不因 clear 一天而删除；Clear 覆盖的历史未确认来源不再阻止终结 Episode 回收。删除 Episode 前写 remove change，Camp aggregate 删除则由同一事务级
cascade 和 Journal trigger 收口。

## References

- [ADR-0175](../adr/0175-core-owned-notification-occurrence-episode-and-change-journal.md)
- [Notification Episode v3](../contracts/notification-episode-v3.md)
- [Current User Attention v3](../contracts/current-user-attention-v3.md)
