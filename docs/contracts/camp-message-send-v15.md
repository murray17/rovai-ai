---
document_type: protocol-contract
contract: camp-message-send
authority: camp-message-send-with-private-composer-queue
status: accepted
version: 15
last_updated: 2026-08-30
---

# Camp Message Send v15 Contract

v15 replaces [v14](camp-message-send-v14.md). Agent Send、附件快照、PublicOnly、Delivery、Gather 和
User Automation 保持原语义。本版仅增加 Desktop Composer 的 next-turn admission。

`camp.messages.send` 的输入仍是 commandId、campId、draftRevision 与 execution；Core 按
[Pending Camp Input v1](pending-camp-input-v1.md) 决定直接公开或私有入队。入队的 commandResult 为
accepted / `pending_input.queued`，payload 只有 pendingInputId，不伪造 Message/Turn/Run ID。
Renderer 在收到 Core 决定前不显示公共乐观消息；只有存在正式 campMessageId 才可进入公开时间线。

发布 Pending 复用同一消息内核和结构化输入校验，读取当前接收者配置，并原子创建 Message/Turn/Run。
成功结果身份与 Pending 发布结果同事务保存。Pending 不携带附件，也不消费当前普通 Draft。
