---
document_type: interface-contract
contract: camp-composer-draft
version: 2
status: accepted
authority: camp-composer-draft-revision-reply-continuation-and-user-send
last_updated: 2026-08-14
---

# Camp Composer Draft v2

## 1. Scope

本合同继承 v1 的 exact revision、Structured Content、附件、持久 reply intent、显式修复和 Draft-only
user send，并增加 recipient continuation。附件 ingress 与快照限制仍由
[Camp Attachment v1](camp-attachment-v1.md)拥有；本合同不改变 Agent-authored send、Message Delivery
或 Agent caller return。v1 是历史合同，不再作为当前实现入口。

## 2. Draft view

```ts
type CampComposerContinuationIntentView = {
  sourceCampMessageId: string
  recipient: {
    agentId: string
    displayName: string
    recipientAvailability: "available" | "unavailable"
  }
  recipientSelectionRequired: boolean
}

type CampComposerDraftView = {
  campId: string
  body: string
  content: StructuredCampMessageContent
  revision: number
  attachments: PreparedAttachmentView[]
  replyIntent: CampComposerReplyIntentView | null
  continuationIntent: CampComposerContinuationIntentView | null
  updatedAt: string | null
  expiresAt: string | null
}
```

`CampComposerReplyIntentView` 保持 v1 shape。SQLite 在 `camp_composer_draft` 持久化：

- `continuation_source_message_id`：已经由 Renderer 展示并随 save 交回、经 Core 验证的来源；
- `continuation_suppressed_source_message_id`：用户点击 `×` 或空白候选失效后不得再次投影的来源；
- `recipient_selection_touched`：当前 Draft 是否发生过用户主动接收者改变。

展示名与当前 availability 是 Core read projection。没有 Draft row 时，Core 可以从最近 accepted user
message 动态投影候选；动态候选已不可接收时不投影。已有 source 的有内容/附件 Draft 即使对象失效也继续
投影，以便修复而不是回退。

## 3. Candidate eligibility and priority

最近一条未 tombstone 的 user-authored CampMessage 必须同时满足：

1. `addressMode = explicit`；
2. `addressedAgentIds` 恰好一个；
3. 该 Agent 不是当前 Default Lead；
4. 当前 Draft 没有同来源 suppression 或 `recipientSelectionTouched`。

不得跳过一条不合格的最新 user message 去寻找更早候选。Agent 消息不改变“最近 user message”。
Default、Lead、Broadcast、多 Agent 和新 Camp 首消息都不产生候选。

同一 Draft 的展示与发送优先级为：

1. unresolved recipient repair；
2. reply intent；
3. 任意 Structured Member/All Mention；
4. continuation intent；
5. Default Lead。

reply 或显式 Mention 只隐藏 continuation，不删除已冻结 source；但用户手动改变 Mention 会设置
`recipientSelectionTouched=true` 并永久关闭当前 Draft 的 continuation。回复 Agent 自动插入的 Mention
不算手动改变；取消回复保留该 Mention。回复 user/system 未加入 Mention时，取消可恢复被隐藏候选。

## 4. Exact-revision mutations

### `camp.composerDraft.save`

```json
{
  "campId": "camp-…",
  "expectedRevision": 7,
  "content": [{"kind":"text","text":"继续"}],
  "continuationSourceMessageId": "message-…"
}
```

`continuationSourceMessageId` 可为 `null`。Core 仅当它仍是最近合格 user message、未抑制、当前 content
没有显式寻址、没有 reply 且用户未触碰接收者时冻结 source。调用者不能指定 Agent ID。首次附件 prepare
前必须先用同一 source 保存 Draft，以便对象在附件接入竞态中失效时仍能修复。

Core 比较新旧 Structured recipient signature；Member/All Mention 发生变化时设置
`recipientSelectionTouched=true`。该位一旦为 true，在 Draft 被 accepted/discard/expiry 消费前不复位。

### `camp.composerDraft.dismissContinuation`

```json
{
  "campId": "camp-…",
  "expectedRevision": 7,
  "sourceCampMessageId": "message-…"
}
```

source 必须是当前 frozen 或动态候选。mutation 清除 frozen source、保存 suppression，保留正文、附件、
reply 与 Structured Content。它既服务用户 `×`，也服务“标签出现后、Draft 仍空时对象失效”的持久抑制。

### `camp.composerDraft.resolveContinuationRecipient`

```json
{
  "campId": "camp-…",
  "expectedRevision": 8,
  "agentId": "agent_…"
}
```

只允许在 frozen continuation source 的修复路径使用。所选 Agent 必须是当前可接收 CampMember，且不能是
已经失效的原对象。Core 在正文开头插入或复用 canonical Member Mention，设置
`recipientSelectionTouched=true`，清除 source 并 suppression 原来源。草稿与附件不变。

v1 的 `startReply / cancelReply / resolveReplyRecipient` 继续存在。显式 reply replacement 也设置
`recipientSelectionTouched=true`；start/cancel 本身保留 continuation 字段。

## 5. Exact Draft send and materialization

用户发送 wire 继续只提交 `commandId + campId + draftRevision + execution`。Core 从 exact Draft 读取全部
字段，并按下列顺序处理 continuation：

1. reply requirement 与 reply source 先按 v1 校验；
2. 若没有 reply、没有显式 Mention、未触碰接收者且 frozen source 未被 suppression，解析来源消息唯一
   Agent；
3. Agent 当前可接收时，在内存中的 Structured Content 开头物化 canonical Member Mention；
4. Agent 不可接收、来源无效或身份不可解析时返回 `continuation_recipient_required`；
5. 对物化后的完整 Structured Content 执行普通 Mention validation、render、address freeze 与原子提交。

accepted CampMessage 因而保存 `addressMode=explicit`、唯一 `addressedAgentIds` 和真实 Structured Mention，
但 `replyToCampMessageId=null`。accepted 后消费整个 Draft；下一 Draft 只从新消息的最终冻结寻址重新计算。

## 6. Stable failures and no fallback

| code | 含义 | Draft 结果 |
| --- | --- | --- |
| `continuation_source_invalid` | save/dismiss 指定的来源不再是当前合法来源 | 刷新当前 Draft |
| `continuation_recipient_required` | frozen 延续对象失效或来源无法再安全物化 | 原样保留并要求显式换人 |
| `continuation_replacement_invalid` | 替代选择仍是原失效对象 | 原样保留 |
| `mention_target_unavailable` | 所选替代成员或其他 Structured Mention 失效 | 原样保留 |
| `draft_changed` | expected revision 过期 | 返回/重新加载当前 Draft |

以上失败以及 v1 reply failures 均不得清空 Draft、创建 CampMessage/CampTurn/AgentRun/Delivery，或把 failed
continuation 当成“无显式寻址”后交给 Default Lead。Renderer 可以提前展开修复，但 Core 是竞态最终权威。

## 7. Migration

schema migration 85 / projection schema 40 增加三个字段。旧 Draft 不伪造 continuation source；已有正文或
附件的旧 Draft 迁移为 `recipientSelectionTouched=true`，保持升级前的显式/Default 路由。空白旧 Draft
可以按升级后的最近 accepted user message 动态投影候选。

## References

- [ADR-0187](../adr/0187-durable-composer-recipient-continuation.md)
- [ADR-0185](../adr/0185-durable-composer-reply-intent-and-explicit-recipient-resolution.md)
- [Camp Composer Draft v1（historical）](camp-composer-draft-v1.md)
- [Camp Attachment v1](camp-attachment-v1.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
- [结构化 Mention](../ui/components/structured-mentions.md)
