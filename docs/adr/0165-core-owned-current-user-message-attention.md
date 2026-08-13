---
document_type: adr
id: ADR-0165
title: Core-Owned Current-User Message Attention
status: accepted
date: 2026-08-12
decision_scope: cross-version
source_version: v0.65
supersedes: []
superseded_by: null
---

# ADR-0165: Core-Owned Current-User Message Attention

## Context

Agent 已能用 `--to` 与 inline Agent Addressing Token 发布公共消息并唤醒队员，但没有一种安全、
可审计的方式明确提醒当前用户。把 `@你` 当正文模式会混淆普通文字与身份引用；只在 Renderer 加样式
会在重载、Context、search 和通知之间分叉；把 user ID 暴露给 Agent 则会提前引入未认证的多用户
routing。若通知在消息提交后由 Renderer 或 event consumer 补建，崩溃和重放还会留下消息与用户注意力
不一致的双写窗口。

现有数据内部使用过 `local-user` literal，但本版本产品决定把当前本地用户的唯一 canonical identity
固定为 `local_user`。同时，Agent recipient 会产生 Message Delivery、AgentRun 和 A2A budget，用户
注意力只需要结构化正文和持久 Inbox；把两者塞进同一个 recipient set 会制造虚假的 Delivery 与 Task
cardinality。

## Decision

1. 本版本的唯一 Current User identity 是 Core-owned `local_user`。Agent 只提交
   `mentionUser: true` / `--to-user`，不能提交 user ID、alias、`me` 或 `user`；Renderer 也不推断身份。
2. Agent routing 与 User attention 是两个正交轴。`to` 与 strict inline Agent tokens 形成
   Effective Agent Recipients、Message Delivery 和 A2A responsibility；`mentionUser` 形成
   `current_user_mention(local_user)` 与 User Mention Notification，永远不创建 Delivery 或占用 slot。
3. Structured Camp Message Content 墠加 closed Current User Mention segment。CampMessage 内容的唯一
   权威是有序 Structured Content；Agent 的 submitted body 只保留为 command input/evidence，所有可见
   body、search、Context、Clipboard、摘要与 accessibility 都从 Structured Content 投影。
4. `mentionUser=true` 的接受事务原子创建 CampMessage、Current User Mention、每个 Agent recipient
   的 Delivery/slot 和一条 `camp_message_user_mention` Notification。Notification recipient 固定为
   `local_user`，source 固定为同一 message；唯一键为 kind + recipient + source message。
5. Durable replay 复用原消息、segment、identity、notification 和 Deliveries。显示名称只影响当前
   presentation；不得改变 semantic digest、持久 identity 或 replay。
6. `taskId` 继续要求恰好一个 Effective Agent Recipient，Current User Mention 不计入该集合。
   exact CampMessage read 增加分离的 Agent recipient 与 `mentionsCurrentUser` 安全投影；compact send
   output 不增加 user 字段。
7. `local-user → local_user` 采用 clean break。Rovai-owned incompatible data、projection 和 frozen
   Context 可以清理或重建，不保留 alias、双 reader 或双 writer；用户 Project 与 Runtime-owned data
   不在清理范围。

本决策细化 ADR-0087 的通知来源键与原子生成、ADR-0128 的 Structured Content 模型、ADR-0130 的
Public Message/Delivery 分离和 ADR-0135 的 compact output；这些 ADR 的其余边界保持生效。

## Consequences

- 消息、Mention 与通知只有一个接受点，崩溃或幂等重放不会产生幽灵通知或裸 Mention；
- 普通正文 lookalike 永远只是 Text，用户和 Agent 可以从结构与 exact read 判断真实 attention；
- Renderer、search、Context 和 Clipboard 必须共享 Core projection 语义，不能继续把持久 `body` 当成
  可独立修改的真源；
- Notification schema、Camp read、Context Formatter/Manifest、Data Contract、CampSnapshot 和 Built-in
  Transport 都需要发布新版本；
- 固定单用户使本版本可验证，但未来多用户必须通过新 ADR/合同引入 authenticated binding，不能把
  `mentionUser` 偷换成 Agent-selected ID。

## Rejected Alternatives

- **解析 `@你`、显示名或 `@local_user`。** 普通文字会因语言、改名或巧合变成 mutation，无法稳定
  区分视觉 Mention 与真实通知。
- **把当前用户加入 Effective Recipients。** 会伪造 Message Delivery、Task recipient、A2A budget 和
  AgentRun，混淆人类 attention 与执行责任。
- **Renderer 创建或补偿通知。** 无法与 Core CampMessage 同事务提交，重载和多窗口会分裂身份、已读
  与幂等状态。
- **Agent 提交 user ID。** 当前没有 authenticated multi-user binding；可变 ID 会扩大攻击与兼容面，
  同时破坏唯一当前用户决定。
- **在 Agent success output 增加 `userMentioned`。** 原子接受已由 `messageId` 表示；增加布尔值会扩大
  compact projection，却不能在 indeterminate/no-locator 场景提供权威确认。
- **保留 `local-user` alias 双读。** 会让同一用户拥有两个 durable identity，并把 clean break 变成
  永久兼容层。

## References

- [v0.65 版本目标](../versions/v0.65/README.md)
- [v0.65 实现规格](../versions/v0.65/implementation-spec.md)
- [ADR-0087: Core-Owned Durable In-App Notification Inbox](0087-core-owned-durable-in-app-notification-inbox.md)
- [ADR-0128: Structured Draft-Only User Message Submission](0128-structured-draft-only-user-message-submission.md)
- [ADR-0130: Public A2A Messages and Unified Delivery](0130-public-a2a-message-and-unified-delivery.md)
- [ADR-0135: Compact Agent Output](0135-compact-agent-output-over-canonical-built-in-tool-envelope.md)
- [Camp Message Send v5](../contracts/camp-message-send-v5.md)
- [Camp Message Send v4 (historical)](../contracts/camp-message-send-v4.md)
- [Current User Attention v1](../contracts/current-user-attention-v1.md)
