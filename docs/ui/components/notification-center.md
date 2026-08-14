---
document_type: ui-component
authority: notification-attention-presentation
status: accepted
target_version: cross-version
last_updated: 2026-08-14
---

# 应用内提醒与会话未读

生产界面暂时隐藏持久 Notification Center、品牌行铃铛和全局未读总数。Core Notification Episode 仍是
唯一持久注意力真源；隐藏 surface 不删除历史，不改变 admission、acknowledgement、clear、retention 或
Change Journal。Renderer 只呈现短暂应用内提醒和 Camp 行“有新回复”状态。

## 应用内提醒

设置侧栏使用用户语言“提醒”。页面只控制一个总开关和四类默认开启的临时浮层：待审批、提到你、
本轮完成、执行未完成；普通队员消息没有提醒类别。关闭总开关只暂停浮层，不抹除四类选择，也不改变
Core 的持久注意力事实。

启动或 reload 先建立当前 Journal high-water，不补弹历史。运行中只有新的 exact `headsUpSignal` 可加入
内存队列；同时最多显示一条，相同 Episode 的新 signal 原地更新。浮层标题、摘要、点击和精确确认全部
使用 signal，不读取 Episode 当前 primary semantic/action 替代。内部 `open_camp` action 在界面统一呈现
为“打开会话”，不得暴露领域对象名。

应用失焦、隐藏或在后台时，队列可以接收新 signal，但浮层不挂载且 8 秒计时不开始；重新获得前台注意
后才显示当前一条。Hover、focus 和动作提交期间暂停计时。关闭或超时只移除本次临时呈现，不
acknowledge、不 clear。更多项以“还有 N 项新提醒 / 查看下一条”逐项推进，不跳转到已隐藏的通知中心。

队列 signal 只由 Journal 的 exact acknowledgement、Clear revision 或 Episode remove invalidation 失效。
resolved Approval 的旧 pending signal 必须删除，即使该 Occurrence 仍未确认；reset/重新建立 baseline
直接清空队列，不从历史或 Episode 推荐动作恢复。

## 会话未读点

Camp 行只用小点提示“有新回复”，不显示跨会话总数。小点使用 attention 语义色，并同时通过整行
`aria-label`、title 和屏幕阅读文本表达“有新回复”，不能只靠颜色。

Camp Snapshot 加载、后台刷新、停留在设置/记忆/队员页或应用失焦都不能消除小点。只有目标 Camp 已是
当前“会话”页面、Snapshot identity 匹配、文档可见且窗口拥有焦点时，Renderer 才提交该 Camp 的
`navigation.campViewed`；失败保持小点并有界重试。打开 Camp 后无需再点击某个“查看本轮”按钮。

Camp 行未读点与 Notification Episode acknowledgement 是两条独立 seam：前者表示会话导航需要注意，
后者仍需精确消息/本轮/审批来源真实进入可见视口后确认。不得用 Camp 级 viewed 顺带批量确认屏幕外
Occurrence。

## 精确可见确认与错误

会话区只在前台“会话”视图采集当前时间线视口内的 `messageId/campTurnId` 和实际展开可见的 pending
`approvalId`。Core 只确认已观察 Journal 边界内匹配的 Active Attention；普通打开会话因此可以自然
读掉已经看到的来源，但屏幕外历史与稍后新到达的来源保持未读。

浮层动作先持久化其 exact acknowledgement，再导航。保存失败保留注意力；保存成功但定位失败不恢复
未读，并通过 App 全局 toast 说明“已标记为已读，但未能定位”，不在已隐藏 surface 中留下孤立行内
错误。

## 视觉与无障碍

浮层沿用 Porcelain Day / Steel Night 的 raised overlay、Steel edge 和开放行，不增加渐变、glow 或独立
卡片世界。长会话名和 CJK/emoji 摘要允许收缩/换行；支持键盘操作、`aria-live=polite`、reduced motion、
最小窗口与 200% zoom，出现和更新都不得抢走当前键盘焦点。

## References

- [Notification Episode v4](../../contracts/notification-episode-v4.md)
- [Current User Attention v4](../../contracts/current-user-attention-v4.md)
- [App Shell 与统一侧栏](app-shell-navigation.md)
- [DESIGN.md](../../../DESIGN.md)
