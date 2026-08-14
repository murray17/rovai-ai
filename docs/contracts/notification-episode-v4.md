---
document_type: contract
name: Notification Episode
version: v4
status: accepted
source_version: v0.76
last_updated: 2026-08-14
---

# Notification Episode v4

## 1. 范围与 v3 变化

本合同替代 Notification Episode v3 作为当前通知接口。v3 的 immutable Occurrence、Active Attention、
exact HeadsUpSignal、exact invalidation、事务式 Renderer cursor、pending-first Approval、
`acknowledge_only` 和 reset 清空继续成立。v4 新增“会话可见来源确认”，不改变 Inbox/Change Journal v6
read wire，也不把 Episode 推荐动作扩成 Active Attention 索引。

## 2. 可见来源命令

Renderer 通过 `notifications.acknowledgeVisibleSources` 提交标准 User Command envelope：

```text
commandId
command {
  campId
  observedThroughChangeSequence
  visibleMessageIds[]
  visibleCampTurnIds[]
  visibleApprovalIds[]
}
```

三个 ID 列表合计必须为 `1..600`，每个 ID 非空；`campId` 非空；
`observedThroughChangeSequence` 必须位于 `0..durable high-water`。违反 closed input 返回
`notification_episode.invalid_visible_sources_boundary`，未来边界返回
`notification_episode.future_visible_sources_boundary`。

Core 在一个命令事务中只选择：

- `recipientUserId == local_user` 且 `campId` 精确相等；
- `admittedChangeSequence <= observedThroughChangeSequence`；
- `admittedAttentionRevision > clearedThroughAttentionRevision` 且尚未 acknowledged；
- `user_mention` 的 `sourceMessageId` 位于 `visibleMessageIds`；
- `turn_completed | turn_failed | turn_incomplete` 的 `campTurnId` 位于
  `visibleCampTurnIds`；
- `approval_pending` 的 `approvalId` 位于 `visibleApprovalIds` 且来源仍未 resolved。

匹配 Occurrence 的 `acknowledgedAt` 在同一事务更新，既有 disposition trigger 为每条实际变化追加精确
Journal invalidation。结果 code 为 `notification_episode.visible_sources_acknowledged`，payload 返回
`campId`、观察边界、`resultingChangeSequence` 和实际 `changed` 数量。重复命令或重复来源报告返回 applied
且 `changed=0`，不产生新的 Journal change。

## 3. Renderer 接收与恢复

会话区只在应用前台、会话视图真实可见且通知抽屉关闭时采集与视口相交的精确 DOM 来源 ID。滚动、尺寸
变化、窗口重新聚焦和 Camp Snapshot 更新都重新计算；地图、屏幕外节点、收起的 Approval 与后台窗口
上报空集合。

Notification Center 使用当前 Inbox `throughChangeSequence` 作为命令观察边界。applied 后立即重读
Inbox，使顶部角标和 Drawer 未读一致；失败不推进任何 Renderer 已读状态，并在同一来源仍可见时退避
重试。新 Journal change 提升边界后，同一可见来源可以再次上报，以确认刚 admitted 的新 Occurrence。

## 4. 不变边界

- `primaryAction + secondaryActions` 仍只是推荐/展示动作，不能用于构造可见来源全集；
- 普通 Camp 导航本身不确认任何内容，确认依据是导航后精确来源可见；
- `markAllRead` 仍是唯一显式跨不可见来源批量确认；
- heads-up signal 入队、失效、cursor 提交与 reset 继续遵守 v3。

## References

- [Notification Episode v3 (historical)](notification-episode-v3.md)
- [Current User Attention v4](current-user-attention-v4.md)
- [ADR-0175](../adr/0175-core-owned-notification-occurrence-episode-and-change-journal.md)
- [Notification Episode 架构](../architecture/notification-episodes.md)
