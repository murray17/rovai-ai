---
document_type: interface-contract
contract: camp-composer-draft
version: 3
status: accepted
authority: camp-composer-draft-attachment-only-user-send
last_updated: 2026-08-20
---

# Camp Composer Draft v3

## 1. Scope

本合同继承 [v2](camp-composer-draft-v2.md) 的 exact revision、Structured Content、附件、reply、recipient
continuation、显式修复、发送物化与无 Default Lead fallback。它只改变用户 Draft 的 sendability：ready 附件
可以在正文为空时独立构成发送 payload。Agent-authored `camp.message.send`、Attachment View、Context shape 与
AgentRun 数据结构不在本合同中改变。

## 2. Sendable payload

Core 必须按以下顺序解析 exact Draft：

1. 按既有 Structured Content 和当前成员显示名渲染 `body`；
2. 按 `ordinal, id` 读取当前 Camp 中 `prepared_attachment.state = 'ready'` 的全部 ID；
3. 仅当 `body.trim().is_empty() && preparedAttachmentIds.is_empty()` 时拒绝。

拒绝继续使用兼容错误码 `camp_message.empty_body`，文案为：

```text
Camp message must contain text or at least one ready attachment
```

preparing、error、failed、缺失或不属于 exact Draft/Camp 的附件不满足 ready 条件。Renderer 可以提前阻断，
但 Core 是竞态最终权威。

## 3. Accepted attachment-only message

正文为空且至少一个 ready 附件的 accepted 结果必须满足：

```text
camp_message.body = ""
camp_message.structured_content_json = "[]"
message_attachment count = exact ordered ready attachment count
```

不得生成“[附件]”“请查看附件”或附件名正文。现有 address/reply/continuation 物化仍先于最终提交；没有显式
收件人时继续使用 Default Lead。Pending Camp 的首条纯附件消息可以激活 Camp，但不得用附件名生成 Camp 标题。

Desktop 继续提交既有 `execution` shape。因为 AgentRun purpose 保持非空，纯附件请求使用固定 purpose：

```text
Camp attachment-only message
```

该值只属于 AgentRun execution fact，不写入 CampMessage、Structured Content、搜索、回复摘要或
`CURRENT_INPUT.message`。

## 4. Atomicity and failure

View publication 必须在消息事务前按现有合同完成。消息事务仍原子创建 CampMessage、CampTurn、AgentRun、
`message_attachment` 并消费 Draft。publication、operation matching、attachment consume、AgentRun queue 或事务
任一步失败时，不得留下其中任一新公共或执行事实；完整 Draft 与 Prepared Attachment 保留以便恢复。

本合同不修改 publication journal、generation fence、copy phase、Attachment View receipt 或数据库事务顺序。

## 5. Renderer and Context projection

发送按钮和程序化 submit guard 使用同一判断：

```ts
hasReadyAttachment = (composerDraft?.attachments.length ?? 0) > 0
hasSendablePayload = message.trim().length > 0 || hasReadyAttachment
```

`preparingAttachments.length > 0`、`failedAttachments.length > 0`、`composerDraft === null`、busy/submitting、
unavailable mention、reply/continuation repair 与 routing mutation 继续阻断。

Timeline 保留完整消息容器、作者、时间、复制/回复操作和附件卡；只有 `displayBody.trim().length > 0` 时渲染
正文气泡。附件区域始终按 `campMessage.attachments` 渲染。

Formatter 21 的 `CURRENT_INPUT` shape 不变：纯附件用户消息的 `message` 为 `""`，`attachments` 是成功
publication 后由 Published Attachment path resolver 生成的稳定 Runtime View 绝对路径。

## 6. Non-goals

- 不按附件文件名搜索消息；
- 不用附件名生成回复摘要或 Camp 标题；
- 不修改 `contentDigest`、Context formatter/version、`CURRENT_INPUT`、`SHARED_CONVERSATION` 或 Attachment View；
- 不异步绑定已发布空消息。

## References

- [Camp Composer Draft v2](camp-composer-draft-v2.md)
- [Camp Attachment v2](camp-attachment-v2.md)
- [Camp Composer Draft 架构](../architecture/camp-composer-draft.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
- [V1.16-D01](../versions/v1.16/decisions.md#v1-16-d01)

