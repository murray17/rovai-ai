---
document_type: ui-component
authority: notification-center-presentation
status: accepted
target_version: cross-version
last_updated: 2026-08-14
---

# Notification Center

Notification Center 是 Core Notification Episode 的桌面呈现，不是第二个聚合器。Drawer 一项一卡；未读
徽标计 Episode，不计原因。普通队员消息不进入该 surface。

## 信息层级

每行依次呈现：未读标识、Core primary semantic 的本地化标题、主要说明、可选 Mention 摘要/剩余数量、
会话标题与相对时间。优先级为失败、未完成、未满足完成、Mention；Approval 独立排序在待处理事项前部。
标题保留最高来源语义，当前 attention action 可以在高优先级原因已确认后推进到较低优先级 Mention。

Main action 只执行 Core 返回的 typed action。不可用动作保持 disabled 并解释“来源不可用”；可用次动作
作为独立文字按钮，不能自动 fallback。激活带 acknowledgement 的 action 时先持久化精确确认；保存失败
保留未读和 Drawer，保存成功后导航失败不恢复未读，并显示可恢复的行内错误。
内部 `open_camp` action 在普通界面统一呈现为“打开会话”，不得暴露领域对象名。

`acknowledge_only` 呈现为“知道了”，只持久化精确确认并留在 Drawer，不进入会话导航。Approval 卡片
必须优先提供仍 pending 的可处理动作，不能让已处理的旧 Approval 形成 disabled 主按钮。

## Heads-up

同时最多展示一个 heads-up。相同 Episode 新版本原地更新，不排入第二张；关闭或超时后仅 Journal 的新
exact `headsUpSignal` 可重新显示。浮层标题、摘要、点击和确认全部使用该 signal，不能读取 Episode 当前
primary semantic/action 替代。启动与 reload 先建立 Inbox high-water，不补弹历史。Hover、focus 和窗口
不可见时暂停计时；关闭只关闭本次浮层，不 acknowledge 或 clear。

已排队 signal 只由 Journal 的 exact acknowledgement、Clear revision 或 Episode remove invalidation 失效。
普通 Inbox reload、筛选切换和其他 Episode 更新不拿 `primaryAction + secondaryActions` 清理浮层；这些字段
不是 Active Attention 全集。resolved Approval 的旧 pending signal 必须删除，即使卡片继续以同一
acknowledgement ID 提供“知道了”。可见队列与 overflow 都保留精确 identity；reset 直接清空临时队列。

## 状态与操作

- All / Unread filter 保持 Drawer、焦点和分页上下文；
- “全部已读”使用当前 Inbox `throughChangeSequence`；操作期间新变化保持未读；
- 单项清除使用该行 `attentionRevision`；新 attention revision 才重新出现；
- Loading、Empty、Partial、Error、Submitting、Reset/Recovery 都保留 Drawer 外壳和关闭入口；
- Journal reset 重新读取 Inbox，不重播 heads-up。
- 增量分页只推进局部 candidate cursor；精确可见性处理、Inbox 接收或浮层入队失败时，共享 cursor 保持
  原值以便幂等重试。

## 视觉与无障碍

沿用 Porcelain Day / Steel Night 的 raised overlay、Steel edge 和 open rows，不增加卡片墙、渐变、glow 或
主题分叉。长会话名和 CJK/emoji 摘要允许收缩/换行且不挤掉动作；支持键盘导航、Escape 关闭、焦点
返回、`aria-live=polite`、reduced motion、最小窗口与 200% zoom。

## References

- [Notification Episode v3](../../contracts/notification-episode-v3.md)
- [Current User Attention v3](../../contracts/current-user-attention-v3.md)
- [DESIGN.md](../../../DESIGN.md)
