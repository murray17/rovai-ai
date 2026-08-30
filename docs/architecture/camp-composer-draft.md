---
document_type: architecture
architecture: camp-composer-draft
authority: camp-composer-draft-and-user-send-boundaries
status: accepted
last_updated: 2026-08-27
---

# Camp Composer Draft 架构

Camp Composer Draft 是普通输入框的唯一持久编辑真源；已提交但尚未公开的下一轮输入由私有 Pending Camp Input 拥有。字段、命令和错误见
[Camp Composer Draft v6](../contracts/camp-composer-draft-v6.md)；长期取舍见
[Composer Draft 不变量](foundational-invariants.md#camp-composer)、
[Composer Draft 不变量](foundational-invariants.md#camp-composer)与
[Composer Draft 不变量](foundational-invariants.md#camp-composer)与
[Composer Draft 不变量](foundational-invariants.md#camp-composer)。

## Component authority

| Component | Responsibility |
| --- | --- |
| Renderer timeline | 把用户对稳定消息的“回复”手势提交为 Draft mutation；展示一层父引用，不从 reply relation 或最后发言自行派生路由 |
| Renderer Composer | 投影 reply/continuation/repair/default 优先级，串行提交同 Camp revision mutation，并在可预知失效时原位阻断；不维护第二份路由真源 |
| Camp Draft module | 持久化 Structured Content、Prepared Attachment references、reply、continuation source/suppression、recipient touched、requirements、revision 与 expiry；原子执行路由 mutation |
| Collaboration send | 从 exact Draft revision 读取完整提交，物化有效 continuation Mention，执行最终 reply、Mention 与 execution admission；只在 accepted transaction 消费 Draft |
| Camp Read Model | 解析 reply author、最近 accepted user route、continuation 对象当前 availability 与有界 excerpt；历史作者离队/移除不改写消息引用 |
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

## Sendability and publication flow

```text
exact Draft send
  -> render body
  -> load exact ordered ready Prepared Attachment IDs
     -> non-empty body OR at least one ready attachment
        -> continue with reply / continuation / recipient validation
        -> durable Managed v2 ingest copies/promotes once outside SQLite
        -> final semantic commit consumes Draft and creates available refs + ordinary Runs
     -> empty body AND no ready attachment
        -> reject camp_message.empty_body and preserve the Draft

attachment-only accepted
  -> persist body="" + structured_content_json="[]"
  -> keep managed_attachment / Message refs / CampTurn / AgentRun in the same transaction
  -> no legacy View writer intent; active Runs are neither awaited nor fenced
```

## Continuation flow

```text
latest accepted user CampMessage
  -> exactly one explicit non-Lead recipient
     -> empty Draft projects continuation candidate
        -> reply or explicit Mention: hide candidate
        -> user dismisses / changes recipient: persist suppression or touched state
        -> first content or attachment save: freeze validated source in exact Draft revision

exact Draft send
  -> source still valid and Agent available
     -> materialize canonical Member Mention
     -> freeze explicit recipient and no reply relation
  -> frozen target unavailable
     -> reject continuation_recipient_required
     -> preserve content + attachments and require explicit replacement
```

候选解析只查看最近 accepted user message，不能越过一条 Default/Broadcast/Lead/multi-recipient user
message回看更早记录。动态空白候选可以因失效被抑制；已经冻结且有 payload 的 source 不得降级为 Default。

## Failure and recovery

- 点击时已失效：Draft Read Model 立即返回 `recipientSelectionRequired`；Renderer 展开成员选择并禁用发送；
- 点击后失效：最终 send 返回 `mention_target_unavailable`；Renderer 刷新同一 Draft，将失效 token 与错误
  原位展示，显式 replacement mutation 后才重试；
- reply source 后来不可用：Draft 保留正文与附件并投影 `message_unavailable`；用户可取消或重新选择引用；
- revision 冲突：Renderer 重新加载 Core Draft，不把本地 reply state 覆盖到新 revision；
- 导航、重载与 App 重启：从同一 Draft 恢复 reply dock、requirement、content 与附件；
- accepted 后 replay：复用持久 command result，不要求被消费 Draft 仍存在。
- continuation 在空白 Draft 失效：Renderer 提交 suppression，默认 Lead 文案恢复；同一 source 不再出现；
- continuation 在有正文/附件后失效：Read Model 投影修复，send 返回
  `continuation_recipient_required`，显式 replacement 写入 Member Mention 后才重试；

## Invariants

- 一个 Camp 最多一个 Composer Draft，也最多一个 pending reply intent；
- 一个 Draft 最多一个 continuation source；candidate source 只能是最近 accepted user route，不能由
  Renderer 指定 Agent；
- reply relation、Structured Mention 和实际 recipient snapshot 是可分别审阅的事实；
- 未解决 requirement、失效 continuation 或任一失效 Mention 都不能通过 Default Lead fallback 转成 accepted；
- 取消引用不删除 Mention，删除 Mention也不自动取消引用；
- continuation send 必须先物化 Structured Mention，不能只写 recipient snapshot 或伪造 reply；
- 用户发送 payload 由非空 rendered body 或至少一个 ready Prepared Attachment 构成；preparing/error 不满足，
  纯附件 accepted 时不得生成占位正文；
- parent quote 不是私密 thread、Task、Delivery 或 Agent caller-return edge；
- Pending Camp 没有可回复的稳定消息；reply-only Draft 不构成可发送 payload，首条 accepted 正文或纯附件消息才激活 Camp。

## References

- [Camp Composer Draft v6](../contracts/camp-composer-draft-v6.md)
- [Camp Attachment v6](../contracts/camp-attachment-v6.md)
- [Camp Published Attachment View v4（legacy v1）](../contracts/camp-published-attachment-view-v4.md)
- [Public A2A Message 与 Message Delivery](public-a2a-message-delivery.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)

## Pending next-turn admission

普通 Composer 提交先经过 Core 的 [Pending Camp Input v1](../contracts/pending-camp-input-v1.md)。
Camp 有未完成执行或待发送输入时，纯文本 Draft 转入私有 FIFO；此时不创建公共消息。
入队物化 Continuation，真正发布才读取默认 Lead。Attachment Draft 不能入队，拒绝不消费文件或内容。

Pending 模块只拥有内容和一个 Camp 编辑 token；不保存队列模式、每次按键或文件 Bundle。
Renderer 编辑期间保留原普通 Draft；Core 占用阻止队首发送。异常退出保留占用，用户显式恢复。
现有 Scheduler 每轮读取可发送队首，调用 CollaborationService 的用户消息内核，在一个 SQLite
事务内写 Message/Turn/Run 和 Pending 发布结果。成功后的 Runtime 失败不退回队列。

Composer Stop 复用既有取消命令；只有当前执行完全停止后才自动发布一个队首，后续按正常 FIFO 继续。
没有独立暂停/继续模式；编辑占用、审批和恢复等待通过现有非终态执行阻塞准入，结算后自动推进。
发布失败保留队首并标为 needs_repair，编辑保存后恢复准入或删除后让下一条继续，不增加自动重试。
Agent Send 和 User Automation 不经过 Composer 私有队列。
