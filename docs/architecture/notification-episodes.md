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
       └─ minimal Change Journal entry

Core Notification module
  ├─ inbox() ────────────── current hydrated Episode views
  ├─ changesSince() ─────── journal identities + current hydration
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

## Read hydration

持久 Episode 不复制展示数据。Core 在 read transaction 中连接当前 Camp、CampTurn、Approval、CampMessage
与 AgentProfile，生成 closed `primarySemantic`、reason counts/states、message summary、current display name
和 typed actions。来源不存在或 tombstoned 时 action `available=false`；Episode identity 与用户 disposition
仍保留。标题/显示名/availability 改变不会写 Journal 或增加 attention revision。

## 并发和恢复

- 每个 attention-worthy source 先获得全局 change sequence，再以同一边界写 Occurrence 与 Journal；
- action/acknowledgement 绑定 observed Episode version，clear 绑定 attention revision，mark-all 绑定
  change sequence；
- Inbox cursor 包含首次读取 high-water；Journal cursor 早于 retained floor 时要求 reset；
- App/Renderer 启动先读取 Inbox high-water，历史未读不形成 heads-up；运行中只消费之后的 Journal。

## 保留

Journal 可以独立截断并提升 floor。Episode 只有在所有来源终结后才进入数量/时间回收候选；可重新出现的
Episode 不因 clear 一天而删除。删除 Episode 前写 remove change，Camp aggregate 删除则由同一事务级
cascade 和 Journal trigger 收口。

## References

- [ADR-0175](../adr/0175-core-owned-notification-occurrence-episode-and-change-journal.md)
- [Notification Episode v1](../contracts/notification-episode-v1.md)
- [Current User Attention v3](../contracts/current-user-attention-v3.md)
