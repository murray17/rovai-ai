---
document_type: contract
name: Notification Episode
version: v5
status: accepted
source_version: v1.36
last_updated: 2026-09-07
---

# Notification Episode v5

v5 replaces [v4](notification-episode-v4.md)。Occurrence/Disposition、聚合、Journal、exact signal、
精确可见来源确认、推荐动作、游标和临时提醒生命周期均不变。

Inbox 与增量水合的 `NotificationEpisodeView.camp` 增加可选 `channelSource`，仅由已有渠道绑定在
read transaction 中投影，见 [Channel Camp Naming v1](channel-camp-naming-v1.md)。`camp.title` 保持原始名称，
Renderer 统一添加渠道前缀；闭合绑定不丢来源。来源不写 Episode、Journal 或 attention revision。

旧 reader 可忽略新增字段，新 reader 容许缺失/null；Inbox/Change Journal schema 6 不变。

## 单聊完成提醒

`camp_turn.kind = single_chat` 的 `turn_completed` 不投影 HeadsUpSignal，因此单聊完成不弹出提醒。
Core 根据精确 Occurrence 对应的 CampTurn 判断，不依赖当前打开的面板；已有 Occurrence、Episode、
Journal 和未读语义保持不变。Camp 公屏完成、失败、未完成和审批提醒继续按既有规则投影。

## v1.53：可见来源 acknowledge 调用去重

Renderer 的调用身份取决于当前 Camp、已呈现来源集合与该 Camp 新 occurrence 的 admission；全局
Change Journal cursor 和 Camp Snapshot watermark 只是冻结请求的读取 fence，不能因其他 Camp 或
acknowledge 自身推进游标而再发一次。来源不变且没有新 admission 时，即使其他 Camp 仍未读，也不持续
制造 `changed=0` 调用。真实新 occurrence、来源变化或重新建立基线仍可确认。

未知请求结果的重试保留原 UUID、原来源集合和原 observed-through fence；不能只复用 UUID 却改变 payload。
异步效果依赖变化不得取消 receipt 处理。Core Gateway 的结果持久化、重试回放和审计不变，不能按 changed=0
或成功/失败统一丢记录。
