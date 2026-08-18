---
document_type: interface-contract
contract: camp-composer-draft
version: 1
status: accepted
authority: camp-composer-draft-revision-reply-and-user-send
last_updated: 2026-08-14
---

# Camp Composer Draft v1

## 1. Scope

本合同冻结 ordinary Camp 中 Core-owned Composer Draft 的 exact revision、Structured Content、附件引用、
持久 reply intent、显式接收者修复与 user send 消费边界。附件文件 ingress、快照、限制与 Runtime 路径继续
由 [Camp Attachment v1](camp-attachment-v1.md)拥有；本合同不改变 Agent-authored
`camp.message.send`、Message Delivery 或 Agent caller return。

## 2. Draft view

```ts
type CampComposerReplyIntentView = {
  replyToCampMessageId: string
  targetState: "available" | "message_unavailable"
  author: null | {
    authorType: "user" | "agent" | "system"
    authorId: string
    displayName: string
    recipientAvailability: "available" | "unavailable" | "not_applicable"
  }
  excerpt: string | null
  recipientSelectionRequired: boolean
}

type CampComposerDraftView = {
  campId: string
  body: string
  content: StructuredCampMessageContent
  revision: number
  attachments: PreparedAttachmentView[]
  replyIntent: CampComposerReplyIntentView | null
  updatedAt: string | null
  expiresAt: string | null
}
```

- SQLite 只持久化 reply target ID 与 `recipientSelectionRequired`；author、当前可寻址状态、展示名和 excerpt
  是 Core read projection，不是第二份身份或正文真源；
- excerpt 从父消息当前可见正文生成，折叠换行并有界为 160 Unicode scalar；目标不可用时为 `null`；
- Agent author 的 `recipientAvailability = available` 要求 active CampMember、无 leave request 且
  AgentProfile `present`。Runtime configuration、health、busy 与 readiness 不属于该展示状态；
- user/system author 使用 `not_applicable`，reply relation 不从其历史寻址推导 Agent；
- reply intent 自身使 Draft 成为有意义、可恢复且会刷新七天过期时间的编辑状态。正文非空仍是发送必要条件。

## 3. Revision mutations

所有 mutation 使用 `campId + expectedRevision`，与正文保存和附件 mutation 进入同一 Camp 串行队列。
revision 不匹配返回 `draft_changed`；无变化的幂等 mutation 可以返回当前 revision。

### `camp.composerDraft.startReply`

```json
{
  "campId": "camp_…",
  "expectedRevision": 7,
  "replyToCampMessageId": "message_…"
}
```

目标必须是同 Camp、已有稳定 ID 的 CampMessage；乐观消息不能提交。Core 在一个事务中：

1. 设置新的 reply target；
2. 若作者是当前可寻址 Agent，保留已有 content，并在开头插入该 canonical Member Mention；同一 Agent
   已出现或 `all_members_mention` 已覆盖时不重复，`recipientSelectionRequired=false`；
3. 若 Agent 作者不可寻址，保留 content、不插入该作者 Mention，设置
   `recipientSelectionRequired=true`；已有其他 Mention 不自动视作本次明确换人；
4. 若作者是 user/system，只设置引用，content 不变且 requirement 为 false。

### `camp.composerDraft.cancelReply`

```json
{"campId":"camp_…","expectedRevision":8}
```

只清除 reply target 与 requirement。Structured Content、附件和其中已经可见的 Mention 全部保留。

### `camp.composerDraft.resolveReplyRecipient`

```json
{
  "campId": "camp_…",
  "expectedRevision": 8,
  "recipient": {"kind":"member","agentId":"agent_3"}
}
```

`recipient.kind` 是 `member | all_members`。Member 必须当前可寻址；`all_members` 写入现有
`all_members_mention`。Core 移除当前 reply author 的失效 Member Mention occurrence，插入或复用所选
Structured Mention，保留其他文本、有效 Mention 与附件，并清除 requirement。其他失效 Mention 仍由
普通 Structured Content 校验阻断，不能因本命令被忽略。

正文 `camp.composerDraft.save`、附件 prepare/remove 和 Draft reload 必须保留 reply 字段并使用同一
revision。`discard` 清除整个 Draft，包括 reply intent；过期清理行为不变。

## 4. Exact Draft user send

用户发送参数收窄为：

```json
{
  "commandId": "command_…",
  "campId": "camp_…",
  "draftRevision": 9,
  "execution": {
    "taskId": null,
    "purpose": "…",
    "completionRole": "required"
  }
}
```

`replyToCampMessageId` 不再是发送参数。Core 只从 exact Draft revision 读取 content、全部 Prepared
Attachment、reply target 与 requirement；accepted transaction 把 reply target 写入 CampMessage，并与
正文/附件一起消费 Draft。拒绝或异常保留完整 Draft。

提交顺序至少验证：

1. Camp、actor 与 exact Draft revision；
2. reply target 仍属于同 Camp 且可引用；
3. `recipientSelectionRequired=false`；
4. 每个 Structured Mention 当前有效，并按既有规则派生 Default / Explicit / Broadcast addressing；
5. execution、Runtime 与其他既有 admission gate。

reply target 不进入 recipient union。没有 Mention 且没有未解决 requirement 时，既有 Default Lead 规则仍
适用，例如回复当前用户自己的消息；Renderer 必须在发送前显示该事实。

## 5. Stable failures and no fallback

| code | 含义 | Draft 结果 |
| --- | --- | --- |
| `camp_message.invalid_reply` | 目标不是同 Camp 稳定消息，或提交时已不可引用 | 原样保留 |
| `reply_recipient_required` | 失效原作者尚未由用户显式换人 | 原样保留 |
| `mention_target_unavailable` | 一个 Structured Member Mention 在最终校验时失效 | 原样保留 |
| `draft_changed` | expected revision 不是当前 revision | 返回/重新加载当前 Draft |

上述失败均不得删除 Mention、清空 reply、改投 Default Lead、创建 CampMessage、CampTurn、AgentRun 或
Delivery。Renderer 可以用当前 Draft projection 提前禁用发送并聚焦修复选择，但 Core 继续是竞态最终权威。

## 6. Timeline and optimistic projection

- accepted CampMessage 继续只保存一条 `replyToCampMessageId`，不保存嵌套 thread 或 recipient inference；
- 时间线父引用只展开一层。点击使用 same-Camp anchor load 定位父消息；找不到时显示“引用的消息当前不可用”，
  不落到最近消息；
- optimistic user message 使用冻结 Draft 的 reply target 渲染，但在稳定 message ID 返回前不提供回复入口；
- accepted 后才清空 reply dock；rejected 时正文、附件、引用、requirement 和焦点修复上下文保持可恢复。

## References

- [ADR-0185](../versions/v0.77/decisions.md#adr-0185)
- [ADR-0080](../versions/v0.25/decisions.md#adr-0080)
- [ADR-0128](../versions/v0.43/decisions.md#adr-0128)
- [Camp Attachment v1](camp-attachment-v1.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
- [结构化 Mention](../ui/components/structured-mentions.md)
