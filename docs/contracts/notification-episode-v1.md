---
document_type: contract
name: Notification Episode
version: v1
status: accepted
source_version: v0.71
last_updated: 2026-08-13
---

# Notification Episode v1

## 1. 范围

本合同冻结 Rovai-ai 当前用户通知的持久模型、Core Read Side、写入边界、增量刷新、浮层资格和
Renderer 动作接口。普通 Agent 公屏消息只属于 Camp 时间线，不产生通知事实、全局未读或浮层。

通知语义的关闭集合是：

```text
approval_pending
user_mention
turn_completed
turn_failed
turn_incomplete
```

用户主动 Stop 形成的 `CampTurn.cancelled` 静默；required AgentRun、Delivery、预算和恢复失败只能参与
CampTurn 权威聚合，不能直接产生通知。

## 2. 三层持久模型

### 2.1 NotificationOccurrence

Occurrence 是一次不可变来源事实，至少保存：

- `occurrenceId`、`recipientUserId`、`semantic`；
- `episodeId` 与稳定 `sourceType + sourceId + sourceRevision`；
- `campId`、可选 `campTurnId`、可选 `sourceMessageId`、可选 `approvalId`；
- `admittedAttentionRevision`、`admittedChangeSequence`、`occurredAt`。

CampMessage、CampTurn 或 Approval 来源事实与 Occurrence 插入必须位于同一 SQLite 事务。重试复用稳定
来源键，不得产生第二个 Occurrence。Occurrence 提交后不可更新；acknowledged、satisfied、resolved
写入独立 disposition。Core 不在通知表复制 Camp 标题、成员显示名、消息正文或最终本地化文案。

### 2.2 NotificationEpisode

Episode 是 Notification Center 中唯一可见和计数的卡片。聚合键为：

| Episode kind | 聚合键 |
| --- | --- |
| `collaboration` | `recipientUserId + campTurnId` |
| `message` | `recipientUserId + sourceMessageId`，仅用于无 CampTurn 的 Mention |
| `approval` | `recipientUserId + campId + approvalAttentionGeneration` |

同一 collaboration Episode 可包含任意多个 Mention 和恰好一个权威 CampTurn 终态。Approval 从合格
pending 数量 `0 → 非 0` 开启新 generation，回到 `0` 时解决；之后再次 `0 → 非 0` 必须创建新
generation/Episode。同一 generation 新增 Approval 更新原 Episode 并重新未读。

`episodeVersion` 随任何持久 Episode 语义或 disposition 变化单调增加。`attentionRevision` 只在新增
attention-worthy Occurrence 时增加；acknowledge、satisfy、resolve、clear、Camp 改名、显示名变化、
摘要重算和 source availability 变化不得增加 `attentionRevision`。

### 2.3 NotificationChangeJournal

Journal 是 Notification owned 的全局单调增量真源。持久字段只包含：

```text
changeSequence
episodeId
episodeVersion
attentionRevision
operation = upsert | remove
changeCause
headsUpReason?
changedAt
```

Journal 不保存 Episode Read View。`changesSince` 在一个读取事务中按 Journal identity 水合当前 view。
`event_log` 只允许作为失效提示，不承担通知重建、游标或 heads-up 真源职责。

## 3. 原因 disposition 与未读矩阵

| semantic | mutable disposition | contributes unread when | attention inactive when |
| --- | --- | --- | --- |
| `user_mention` | `acknowledgedAt` | 未确认 | 已确认 |
| `turn_completed` | `acknowledgedAt`, `satisfiedAt` | 两者均为空 | 已确认或已满足 |
| `turn_failed` | `acknowledgedAt` | 未确认 | 已确认 |
| `turn_incomplete` | `acknowledgedAt` | 未确认 | 已确认 |
| `approval_pending` | `acknowledgedAt`, `resolvedAt` | 未确认，即使已解决 | 已确认；解决只改变业务呈现 |

Episode 只要有一个可见未读 Occurrence 就计为一个未读 Episode。多个未读原因、多个 Mention 或多个
Approval 不增加全局徽标数量。

用户在同一 Camp 发送后续公开输入并由此启动新 CampTurn 时，所有此前尚未满足的 `turn_completed`
Occurrence 进入 satisfied。该操作不确认、满足或清除 Mention。普通打开 Camp 不能满足 completion。

## 4. 主语义与动作选择

协作 Episode 的 `primarySemantic` 优先级固定为：

```text
turn_failed > turn_incomplete > unsatisfied turn_completed > user_mention
```

历史中已满足的 completion 仍投影为 `turn_completed`，但不贡献未读或 heads-up。Approval Episode
独立于协作 Episode；待处理 Approval 在全局排序中优先。

`displaySemantic` 与 `attentionAction` 分离：高优先级历史状态可以继续作为标题，而当前动作必须指向
最高优先级的未确认原因。若失败已确认但仍有 Mention 未确认，标题仍可为失败，主 attention action
则精确指向最早未确认 Mention。

每个 action 具有不透明 `actionId`、closed `kind`、独立 `available`、来源 locator、观察到的
`episodeVersion` 和可选 `acknowledgementId`。Renderer 只能回显这些值，不能从标题、Camp 或新快照
重新推断目标。主动作不可用时不得静默替换为次动作；次动作必须由用户显式选择。

## 5. Mention 精确语义

每条 Current User Mention 是独立 Occurrence 和独立 acknowledgement 单元。同一 Episode 有多条未确认
Mention 时：

- 卡片摘要和主 Mention action 指向最早未确认来源消息；
- 投影剩余未确认数量；
- 精确消息确认后推进到下一条；
- 不提供“确认本事项全部 Mention”的单项动作。

自动确认只接受 exact `messageId`：节点已加载、渲染、与时间线可见视口相交，文档和窗口可见且聚焦，
并且 Core acknowledge 成功。普通 Camp 已读、CampTurn 可见或 Snapshot 刷新不得确认 Mention。

## 6. 深模块接口

Core 对 Renderer 的通知接口只有：

```text
inbox(filter, cursor?, limit?)
changesSince(afterChangeSequence, limit?)
acknowledge(episodeId, observedEpisodeVersion, acknowledgementId)
clear(episodeId, throughAttentionRevision)
markAllRead(throughChangeSequence)
```

另有同一模块拥有的 `preference.get/update`。旧 `createdSince`、`markRead`、`markCampRead`、`clearRead`
接口删除，不提供 alias 或双写。

### 6.1 inbox

返回 schema v4、`throughChangeSequence`、可见 `unreadCount`、Episode views 和可选 cursor。首个 cursor
固定捕获的 `throughChangeSequence`；后续页必须回显同一边界，Core 拒绝跨边界 cursor。分页成员只包含
在该边界前已建立的 Episode，字段从当前 Core 来源水合。

### 6.2 changesSince

返回请求边界、捕获的 high-water、下一游标、`hasMore`、`resetRequired` 和按 sequence 升序的 changes。
请求早于 durable journal floor、晚于 high-water 或 cursor 非法时 `resetRequired=true`，调用方重新读取
Inbox 并把该 Inbox 的 high-water 设为新起点。

应用启动与 Renderer reload 先读 Inbox 并建立 high-water；历史未读仍显示，但不补弹。只有 Journal 中
`headsUpReason` 非空且对应 preference 开启的新 change 可触发浮层。

### 6.3 acknowledge

Core 只确认 `acknowledgementId` 指向、属于该 Episode、且已存在于 `observedEpisodeVersion` 所代表观察
边界的一个 Occurrence。迟到动作不得确认之后的新 Occurrence。幂等重放返回 applied/no-change，不扩大
确认集合。

### 6.4 clear

Clear 只持久化 `clearedThroughAttentionRevision = max(existing, supplied)`。当 Episode 当前
`attentionRevision <= clearedThrough` 时 Read Side 隐藏它；更高 attention revision 必须重新出现且保持
未读。Episode version、Camp 改名、availability 或 disposition 更新本身不得使它重新出现。

### 6.5 markAllRead

只确认 `admittedChangeSequence <= throughChangeSequence` 的 Occurrence。命令执行期间或之后产生的
Occurrence 继续未读。该命令不 clear、satisfy 或 resolve。

## 7. Heads-up

Preference 默认值全部为 true：总开关、待审批、提到你、本轮完成、执行未完成。执行未完成同时控制
`turn_failed` 和 `turn_incomplete`，但文案必须区分失败与无法证明失败的未完成。

允许产生 `headsUpReason` 的变化仅为：新 Mention、新 pending Approval、进入 completed、进入 failed、
进入 incomplete 或更高优先级主语义升级。同一 Episode 当前浮层存在时原地更新；浮层已关闭/超时后，
只有新的上述 change 才能重弹。acknowledge、resolve、satisfy、摘要/标题/显示名/availability 变化、
同一 source replay 和启动历史读取均不能重弹。

## 8. 保留与 clean break

v0.71 不保留尚未上线的旧通知数据或设置。Migration 79 把 Rovai Data Contract 提升为
`v0.71 / projection schema 34`，只删除 Rovai-owned 旧通知表、trigger、preference
和游标，创建新表并写入空 Journal baseline；不回填、不双读、不双写，也不影响 Camp、Message、Turn、
Approval、Project 或 Runtime-owned 数据。

Journal 具有 durable floor；截断后旧 cursor 必须 reset。可重新出现的 Episode 不得按“clear 一天后”规则
删除。Episode 只在全部来源已终结且满足保留策略时删除，并先写 `remove` change；当前合同默认保留
90 天，并仅从已终结 Episode 中执行数量上限回收。

## References

- [ADR-0175](../versions/v0.71/decisions.md#adr-0175)
- [Current User Attention v3](current-user-attention-v3.md)
- [ADR-0087](../versions/v0.28/decisions.md#adr-0087)
- [ADR-0165](../versions/v0.65/decisions.md#adr-0165)
