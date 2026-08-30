---
document_type: interface-contract
contract: camp-composer-draft
version: 6
status: accepted
authority: camp-composer-draft-next-turn-admission
last_updated: 2026-08-30
---

# Camp Composer Draft v6

v6 replaces [v5](camp-composer-draft-v5.md). Draft 字段、revision、Reply、Continuation、附件准备与
Managed v2 提交保持不变；发送先经过 [Pending Camp Input v1](pending-camp-input-v1.md) 的 Core 准入。

可直接发送时执行原有事务；Camp 忙或队列未空时，纯文本 Draft 被原子转换为私有 Pending。
两种成功都会消费 exact Draft，拒绝都保留 Draft。携带附件而需要排队时返回
`pending_input.attachments_unsupported`，不复制、消费或丢弃附件；普通直接发送仍支持附件和纯附件。

Pending 编辑使用独立内存快照，不触发普通 Draft 的延迟保存。保存、取消或删除后重新显示原普通
Draft，包括原附件、Reply 和 Continuation；Pending 发布也不能消费它。
