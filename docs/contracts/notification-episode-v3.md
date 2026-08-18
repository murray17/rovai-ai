---
document_type: contract
name: Notification Episode
version: v3
status: accepted
source_version: v0.71
last_updated: 2026-08-13
---

# Notification Episode v3

## 1. 范围与 v2 变化

本合同替代 Notification Episode v2 作为当前通知接口。v2 的 immutable Occurrence、Active Attention、
exact HeadsUpSignal、事务式 Renderer cursor、pending-first Approval 与 acknowledge-only action 继续成立。
v3 只收紧 exact HeadsUpSignal 入队后的生命周期：Episode 推荐动作不是 Active Attention 全集，Renderer
不得再用 `primaryAction + secondaryActions` 判断已排队 signal 是否仍有效。

## 2. Active Attention 与 Heads-Up Eligible Attention

Active Attention 仍由 v2 的 Clear 和 acknowledgement/satisfaction 规则决定。Approval resolved 但未
acknowledged 时仍可保持 Active Attention 和未读；业务来源不再 pending 后，它不再是 Heads-Up Eligible
Attention。因此 resolved Approval 可以继续提供 `acknowledge_only`，但此前的 `open_approval` signal 必须
失效。

Episode view 的 `primaryAction` 与 `secondaryActions` 只表示当前推荐和当前展示的备选动作。它们不是
Active Attention 或 Heads-Up Eligible Attention 的完整身份集合，不能用于验证临时浮层。

## 3. Change Journal 精确失效合同

Notification Change Journal 为可能影响已排队 signal 的变化保存最小精确事实：

- acknowledgement、satisfaction、resolution 保存受影响的 `acknowledgementId`；
- Clear 保存实际提交的 `clearedThroughAttentionRevision`；
- retention 删除仍以 Episode identity 和 `remove` change 表达。

`changesSince` 使用这些事实投影 closed `headsUpInvalidation`：

```text
source_state_changed {
  acknowledgementId
  throughAttentionRevision: null
}

attention_cleared {
  acknowledgementId: null
  throughAttentionRevision
}

episode_removed {
  acknowledgementId: null
  throughAttentionRevision: null
}
```

`source_state_changed` 表示该精确来源以前形成的临时 signal 已失效；它不宣称底层 Occurrence 已退出
Active Attention。`attention_cleared` 只失效同一 Episode 中
`admittedAttentionRevision <= throughAttentionRevision` 的 signal。`episode_removed` 失效该 Episode 的
全部 signal。

每个 exact `headsUpSignal` 在 v2 字段之外增加 `admittedAttentionRevision`。它与 signal action、semantic、
Mention source 来自同一 Occurrence，供 Clear 边界精确比较。Notification Episode wire schema 为 v6。

## 4. Renderer 队列归约

Renderer 必须按 `changeSequence` 顺序逐条归约变化。对每条 change，先应用
`headsUpInvalidation`，再在该 signal 新鲜、偏好开启且当前允许呈现时接收 `headsUpSignal`。由此：

- 旧 Mention A 未确认、Mention B 新到达时，B signal 不会因 Episode 推荐动作仍指向 A 而被删除；
- Approval signal 在来源 resolved 后立即失效，即使同一 acknowledgement ID 仍用于
  `acknowledge_only`；
- Clear 后同 batch 到达的更高 attention revision signal 仍可入队；Clear 前 signal 不会复活；
- 普通 Inbox reload、filter 切换、标题水合或其他 Episode 更新不得重建、更新或清理队列。

可见队列和折叠的 overflow 都必须保留精确 signal identity，不能只保存一个无法按 Journal change 失效的
历史计数。用户成功确认某 signal 后，Renderer 可以立即按 acknowledgement ID 幂等移除它，无需等待下一轮
Journal poll。

Journal reset、Renderer 初始化或完整重新建立 Inbox baseline 时直接清空临时 heads-up 队列，不从 Episode
actions 恢复历史浮层。Drawer 打开时也可以按既有临时呈现语义清空队列。

## 5. Cursor、保留与 clean break

v2 的 candidate cursor 提交顺序继续成立。精确 invalidation 与新 signal 必须作为同一批变化成功归约后才
提交共享 cursor；失败时重读并幂等归约。

Migration 81 把 Rovai Data Contract 提升为 `v0.71 / projection schema 36`，只给 Journal 增加精确
acknowledgement 和 Clear 边界字段并替换相关 triggers。功能尚未上线，不提供 schema v5 alias、双读或旧
Renderer compatibility branch。

## References

- [Notification Episode v2 (historical)](notification-episode-v2.md)
- [ADR-0175](../versions/v0.71/decisions.md#adr-0175)
- [Current User Attention v3](current-user-attention-v3.md)
- [Notification Episode 架构](../architecture/notification-episodes.md)
