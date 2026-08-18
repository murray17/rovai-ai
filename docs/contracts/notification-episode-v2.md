---
document_type: contract
name: Notification Episode
version: v2
status: accepted
source_version: v0.71
last_updated: 2026-08-13
---

# Notification Episode v2

## 1. 范围与 v1 变化

本合同替代 Notification Episode v1 作为当前通知接口。v1 的 immutable Occurrence、separate
Disposition、materialized Episode、minimal Journal、聚合键、来源原子写入、关闭语义集合与五个深模块
命令继续成立。v2 收紧四个边界：Clear 后的 Active Attention、与单条 Journal change 精确绑定的
heads-up signal、Renderer 事务式 change cursor，以及 Approval pending-first / acknowledge-only 动作。

通知语义仍为 `approval_pending | user_mention | turn_completed | turn_failed | turn_incomplete`。普通 Agent
公屏消息不产生 Notification Occurrence；用户主动 Stop 形成的 `CampTurn.cancelled` 静默。

## 2. 持久模型与 Active Attention

NotificationOccurrence 是不可变来源事实，至少保存 `occurrenceId`、recipient、semantic、Episode identity、
稳定 source identity、locator、`admittedAttentionRevision`、`admittedChangeSequence` 与 `occurredAt`。来源事实、
Occurrence、Episode revision 和 Journal append 在同一 SQLite 事务提交。acknowledged、satisfied、resolved
只写独立 disposition。

NotificationEpisode 仍按以下键聚合：

| kind | 聚合键 |
| --- | --- |
| `collaboration` | `recipientUserId + campTurnId` |
| `message` | `recipientUserId + sourceMessageId`，仅用于无 CampTurn Mention |
| `approval` | `recipientUserId + campId + approvalAttentionGeneration` |

`episodeVersion` 覆盖所有持久语义或 disposition 变化；`attentionRevision` 只在新增 attention-worthy Occurrence
时增加。acknowledge、satisfy、resolve、clear、标题/显示名水合与 availability 变化不增加 attention revision。

对某 Episode，Active Attention 是同时满足下列条件的 Occurrence：

```text
admittedAttentionRevision > clearedThroughAttentionRevision
AND 尚未因 acknowledged / satisfied 失活
```

Approval 的 resolved 只改变业务呈现，未 acknowledged 时仍是 Active Attention。Clear 边界以前的 Occurrence
继续作为历史来源事实，可参与历史标题、`occurrenceCount`、`mentionCount` 和审计；它们不得再参与：

- Episode `unread` 与全局 unread count；
- `unacknowledgedCount`、`unacknowledgedMentionCount` 和当前 Mention 摘要；
- attention action 与 heads-up eligibility；
- retention 的“仍有活跃注意力”判断。

`pendingApprovalCount` 仍投影该 generation 当前实际 pending 的业务来源数量；Clear 处置通知注意力，不解决
Approval 业务状态。它不能改变 attention action 只从 Active Attention 选择的规则。

## 3. 未读、主语义与 action

原因 disposition 矩阵保持不变：Mention/failed/incomplete 未 acknowledged 时未读；completed 仅在既未
acknowledged 也未 satisfied 时未读；Approval 未 acknowledged 时未读，即使已经 resolved。

协作 Episode 的历史 `primarySemantic` 优先级仍为：

```text
turn_failed > turn_incomplete > unsatisfied turn_completed > user_mention
```

历史 display semantic 与当前 attention action 分离。当前 action 只能从 Active Attention 选择；Clear 前
的旧 Mention 不得在 Episode 因新 Occurrence 重新出现后挡住新 Mention。

每个 action 仍包含 opaque `actionId`、closed `kind`、`available`、locator、observed Episode version 和可选
acknowledgement ID。v2 的 closed kind 为：

```text
open_approval | open_camp_message | open_camp_turn | open_camp | acknowledge_only
```

Approval Episode 的 attention action 按以下顺序选择：

1. 最早的、仍 pending 且未 acknowledged 的 Active Attention Approval；
2. 若不存在 pending，但存在 resolved 且未 acknowledged 的 Active Attention Approval，返回
   `acknowledge_only`，`available=true`，只携带该 Occurrence acknowledgement ID；
3. resolved Occurrence 不得以 unavailable `open_approval` 挡住后来的 pending Approval。

`acknowledge_only` 只确认精确 Occurrence，不导航、不 clear，也不把 resolved 等同于 acknowledged。

## 4. Deep module wire

Core 仍只暴露：

```text
inbox(filter, cursor?, limit?)
changesSince(afterChangeSequence, limit?)
acknowledge(episodeId, observedEpisodeVersion, acknowledgementId)
clear(episodeId, throughAttentionRevision)
markAllRead(throughChangeSequence)
preference.get/update
```

### 4.1 inbox

返回 schema v5、`throughChangeSequence`、Active Attention 计算的 unread count、Episode views 和可选 cursor。
首个 cursor 捕获固定 high-water；后续页必须回显同一边界。分页成员由该边界冻结，展示字段从当前来源水合。

### 4.2 changesSince 与 HeadsUpSignal

Journal 持久字段仍保持最小集合，可以内部保存 `headsUpReason`，但 v2 wire 不把 reason 单独交给 Renderer。
每个 change 返回：

```text
change identity + operation + cause + changedAt
episode?: current NotificationEpisodeView
headsUpSignal?: {
  semantic
  action
  mention?
}
```

若 Journal 行具有 heads-up reason，Core 必须以
`Occurrence.admittedChangeSequence == change.changeSequence`（或等价稳定来源 identity）定位精确来源。
只有该来源仍为 Active Attention，且 Approval 来源仍 pending 时才返回 `headsUpSignal`。signal 的 semantic、
action、Mention presentation source 必须来自同一 Occurrence；不得用 Episode 当前 primary semantic/action
替代。Episode current view 只服务通知中心卡片。

同一 batch 中 Mention 后紧随 completion 时，Mention change 的 signal 仍显示并操作该 Mention；多条 Mention
change 分别携带各自 message locator 和 acknowledgement ID。

### 4.3 Renderer cursor commit

Renderer 以共享 cursor 复制出局部 `candidateCursor`，所有分页请求只推进 candidate。只有以下步骤全部成功
后才能提交共享 cursor：

```text
全部分页读取
→ exact visible-source refresh / acknowledgement 处理
→ 当前 Inbox 接收
→ heads-up 入队
→ sharedCursor = candidateCursor
```

任一步骤失败都保留原 shared cursor；重试允许重复读取相同 changes，消费必须幂等。reset 只有在 Inbox
成功接收后才把共享 cursor 设为该 Inbox high-water。

### 4.4 bounded commands

- `acknowledge` 只确认 acknowledgement ID 指向、属于该 Episode、且已存在于 observed Episode version
  边界的一条 Occurrence；
- `clear` 持久化 `max(existing, supplied)`。Read Side 隐藏 `attentionRevision <= clearedThrough` 的 Episode；
  更高 revision 重新出现时，只有 Clear 边界后的 Occurrence 构成 Active Attention；
- `markAllRead` 只确认 `admittedChangeSequence <= throughChangeSequence` 的 Occurrence。

## 5. Heads-up 与 preference

Preference 默认全部开启，分类仍为待审批、提到你、本轮完成、执行未完成和总开关。只有新的、分类开关
开启且 `headsUpSignal` 非空的 change 可以更新 heads-up。Renderer 必须用 signal semantic 选择文案、用
signal action 点击/确认、用 signal Mention 展示摘要；不得用 Episode primary fields 冒充 signal 来源。

同一 Episode 当前浮层存在时，新 signal 原地更新；关闭或超时后只有新的 signal 才能重弹。启动历史读取、
acknowledge、resolve、satisfy、clear、标题/摘要/availability 水合均不补弹。

## 6. Retention 与 clean break

Journal floor/reset、90 天终结 Episode 保留和最多 1000 个 inactive terminal Episode 的策略保持不变。
Retention 的活跃注意力判断只看 Active Attention，因此被 Clear 覆盖但未 acknowledged 的历史 Occurrence
不会永久阻止终结 Episode 回收。删除 Episode 前仍先写 `remove` change。

本功能尚未上线，v2 不提供 v1 wire alias 或双协议。实现直接使用 Notification Episode schema v5；持久
Journal 结构无需因 heads-up signal 水合而复制 presentation fields。

## References

- [Notification Episode v1 (historical)](notification-episode-v1.md)
- [ADR-0175](../versions/v0.71/decisions.md#adr-0175)
- [Current User Attention v3](current-user-attention-v3.md)
- [Notification Episode 架构](../architecture/notification-episodes.md)
