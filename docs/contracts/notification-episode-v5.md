---
document_type: contract
name: Notification Episode
version: v5
status: accepted
source_version: v1.36
last_updated: 2026-08-31
---

# Notification Episode v5

v5 replaces [v4](notification-episode-v4.md)。Occurrence/Disposition、聚合、Journal、exact signal、
精确可见来源确认、推荐动作、游标和临时提醒生命周期均不变。

Inbox 与增量水合的 `NotificationEpisodeView.camp` 增加可选 `channelSource`，仅由已有渠道绑定在
read transaction 中投影，见 [Channel Camp Naming v1](channel-camp-naming-v1.md)。`camp.title` 保持原始名称，
Renderer 统一添加渠道前缀；闭合绑定不丢来源。来源不写 Episode、Journal 或 attention revision。

旧 reader 可忽略新增字段，新 reader 容许缺失/null；Inbox/Change Journal schema 6 不变。
