---
document_type: architecture
architecture: camp-composer-draft
authority: camp-composer-draft-and-user-send-boundaries
status: accepted
last_updated: 2026-08-14
---

# Camp Composer Draft 架构

Camp Composer Draft 是用户下一条 Camp 消息的唯一持久编辑真源。字段、命令和错误见
[Camp Composer Draft v1](../contracts/camp-composer-draft-v1.md)；长期取舍见
[ADR-0080](../adr/0080-durable-camp-composer-draft-and-atomic-attachment-consumption.md)、
[ADR-0128](../adr/0128-structured-draft-only-user-message-submission.md)与
[ADR-0184](../adr/0184-durable-composer-reply-intent-and-explicit-recipient-resolution.md)。

## Component authority

| Component | Responsibility |
| --- | --- |
| Renderer timeline | 把用户对稳定消息的“回复”手势提交为 Draft mutation；展示一层父引用和当前完整接收者，不从 reply relation 自行派生路由 |
| Renderer Composer | 投影 Core Draft、串行提交同 Camp revision mutation，并在可预知的失效状态原位阻断；不维护第二份 reply target |
| Camp Draft module | 持久化 Structured Content、Prepared Attachment references、reply target、显式换人 requirement、revision 与 expiry；原子执行 start/cancel/resolve |
| Collaboration send | 从 exact Draft revision 读取完整提交，执行最终 reply、Mention 与 execution admission；只在 accepted transaction 消费 Draft |
| Camp Read Model | 解析 reply author 的当前身份/可寻址状态和有界 excerpt；历史作者离队/移除不改写消息引用 |
| Timeline projection | 在 accepted/optimistic user message 上显示一层父引用；稳定 ID 到达前不允许继续回复 optimistic message |

## Reply flow

```text
user clicks Reply on stable CampMessage
  -> camp.composerDraft.startReply(expectedRevision, messageId)
     -> active Agent author
        -> persist reply target + visible canonical Mention
        -> recipient selection satisfied
     -> away / left / removed Agent author
        -> persist reply target only
        -> persist recipient selection required
     -> user / system author
        -> persist reply target only
        -> addressing remains independent

exact Draft send
  -> final Core revalidation
     -> accepted: CampMessage.reply_to + content + attachments, then consume Draft
     -> rejected: preserve Draft; never substitute Default Lead for failed explicit intent
```

`startReply` 是显式用户命令，因此可以在一个 mutation 中同时写引用和可见 Mention。普通 Draft load、
send、timeline projection、reply relation 或历史作者都不能自行增加收件人。

## Failure and recovery

- 点击时已失效：Draft Read Model 立即返回 `recipientSelectionRequired`；Renderer 展开成员选择并禁用发送；
- 点击后失效：最终 send 返回 `mention_target_unavailable`；Renderer 刷新同一 Draft，将失效 token 与错误
  原位展示，显式 replacement mutation 后才重试；
- reply source 后来不可用：Draft 保留正文与附件并投影 `message_unavailable`；用户可取消或重新选择引用；
- revision 冲突：Renderer 重新加载 Core Draft，不把本地 reply state 覆盖到新 revision；
- 导航、重载与 App 重启：从同一 Draft 恢复 reply dock、requirement、content 与附件；
- accepted 后 replay：复用持久 command result，不要求被消费 Draft 仍存在。

## Invariants

- 一个 Camp 最多一个 Composer Draft，也最多一个 pending reply intent；
- reply relation、Structured Mention 和实际 recipient snapshot 是可分别审阅的事实；
- 未解决 requirement 或任一失效 Mention 都不能通过 Default Lead fallback 转成 accepted；
- 取消引用不删除 Mention，删除 Mention也不自动取消引用；
- parent quote 不是私密 thread、Task、Delivery 或 Agent caller-return edge；
- Pending Camp 没有可回复的稳定消息；reply-only Draft 不改变 Pending activation 的首条非空正文要求。

## References

- [Camp Composer Draft v1](../contracts/camp-composer-draft-v1.md)
- [Camp Attachment v1](../contracts/camp-attachment-v1.md)
- [Public A2A Message 与 Message Delivery](public-a2a-message-delivery.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
