---
document_type: contract
name: Notification Episode
version: v6
status: accepted
source_version: v1.54
last_updated: 2026-09-07
---

# Notification Episode v6

继承 [v5](notification-episode-v5.md) 的 Occurrence/Disposition、Episode、Journal、精确动作、
游标与重试身份；以下行为替代 v5 的单聊完成过滤与临时卡片投递规则。

## 来源与动作

Inbox / Change Batch 的 `schemaVersion` 升为 7。`NotificationActionView.kind` 增加
`open_single_chat`，`singleChat` 为 null 或 `{ conversationId, agentId, agentDisplayName, agentRunId }`。
所有字段为 string；来源使用 Run 冻结的 `destination_conversation_id`，审批通过 Action 的 Run 解析。
`campTurnId` 仍绑定精确终态，`approvalId` 仍绑定精确审批，acknowledgement / observed version 不变。

单聊完成、失败、未完成与审批只向本机 Owner 提醒，复用现有分类偏好，不创建私有 Mention 或另一通知中心。
卡片点击先确认该精确 Occurrence，再打开原 Conversation / Run 或审批详情；不授予权限，不调用
`singleChat.open`，不替换为同成员的 successor Conversation。已结束、缺失或成员不可用的来源不可导航，
也不新投递 heads-up；已保存事实仍保留。私有正文不进入公共 Camp / Agent / 渠道投影。

Migration 146 仅变更后续状态触发器，不改存储字段、data contract marker 或历史 disposition。
公屏新用户输入只满足公屏完成提醒；私有新用户输入只满足同一 Conversation 的完成提醒。单聊结束时
精确来源 resolved，并通过原有 Journal invalidation 撤下队列，不把未见来源写成 acknowledged。
手动停止 / 结束不生成新的未完成通知。

## 临时提醒

前台且具有焦点时，当前阅读的公屏 / 精确单聊完成不弹卡；仅抑制和移除临时队列，不能据此确认未见内容。
审批、Mention、失败和未完成只在精确内容已经可见时抑制，屏幕外来源仍提醒。规则见
[Current User Attention v5](current-user-attention-v5.md)。

后台继续接收内存信号，不展示、不计时；回前台先收敛 Journal invalidation 和可见区域，再展示仍有效来源。
启动基线不重放历史。一次展示一张卡；同来源同轮的新高优先级信号可原位更新，旧的不同 Occurrence 留在队列。
优先级依次为审批、失败、未完成、Mention、完成；完成不能覆盖更高优先级信号。关闭或 8 秒超时仅隐藏，
剩余队列经轻量“还有 N 条提醒 · 查看下一条”入口按需查看，不自动连续弹出，不因查看下一条而批量确认。
悬停、键盘焦点、操作中与后台均暂停剩余时间；隐藏 / 超时和已读独立。

卡片宽 340px，保留主题，标题只展示来源，正文最多两行；单聊来源为“Camp 名 · 与成员单聊”，
不附加重复类型标题、Runtime、路径、时间或项目页脚。完成文案为“本轮已完成”。
