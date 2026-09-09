---
document_type: protocol-contract
contract: context-manifest-evidence-v23
authority: agent-run-context-evidence
status: accepted
version: 23
last_updated: 2026-09-09
---

# ContextManifest Evidence v23

新建输入使用 Formatter 23 / Manifest 23 / [Delivery Profile 5](context-delivery-profile-v5.md)。继承
[v22](context-manifest-evidence-v22.md) 的公开消息边界、section 顺序、Skill、附件、Gather 和授权规则；
仅增加 [Message Quotes v1](message-quotes-v1.md) 的不可变选文与证据。

`CURRENT_INPUT.quotes` 与 `message`、`skills`、`attachments` 同级，无引用时省略。每项为
`{kind: "message_excerpt", source: {scope: "current_conversation_messages", messageId, author}, text}`。
当前会话由 Core 解析，source 不重复 campId/conversationId。作者仅为归属，选文不能激活成员、Skill、命令或授权。

`current_input_source_json` 新增 `quotedInputEvidence`（有序 quoteId、内部 source、sourceContentDigest、
snapshotDigest）及 `projectedInputDigest`。原 `projectedBodyDigest` 仍只表示新正文；source content digest
在含引用时聚合原正文内容摘要与完整有序快照。共享历史证据同样记录引用证据、全部选文字数与聚合投影摘要。

历史模型消息在 body 之外可选含 quotes。私聊中的公共 SHARED_CONVERSATION 引用使用 `camp_messages` scope，
owner 由 section 的真实 campId 表达，不冒充当前私有会话。

Migration 148 从 v1.55/schema 97 升级至 v1.56/schema 98，所有历史 owner 默认 quotes=[]。
历史 Manifest 不回写；冻结的 v22/22/Profile 4 输入继续使用原始 bytes、digest 和证据。新插入只接受 23/23/5，
或经精确冻结 Delivery 证明的 22/22/4。Bootstrap v3/Formatter 3 保持，Session Charter revision 6
通过 Binding compatibility 轮换新输入所需会话，已有证据保持原文。
