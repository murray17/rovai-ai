---
document_type: adr
id: ADR-0130
title: Public A2A Messages and Unified Message Delivery
status: accepted
date: 2026-08-07
decision_scope: cross-version
source_version: v0.45
supersedes:
  - ADR-0073
  - ADR-0099
superseded_by: null
---

# ADR-0130: Public A2A Messages and Unified Message Delivery

## Context

历史 A2A 把 Agent 间请求、私有输入、收件人记录和后续 AgentRun 分散在 Member Call 与多种
recipient 表中。用户只能看到 AgentRun 的总结，无法把一次协作当作 Camp 公共讨论的一部分；
多个收件人还可能经过不同投递路径，造成幂等、审计和恢复语义分叉。v0.45 尚未上线，不需要
保留旧数据或 alias。

## Decision

采用一条公共消息事实和一个收件人责任模型：

1. `camp.message.send` / `rovai send` 是唯一 Agent-authored A2A 发送操作。每次成功请求先
   原子提交一个 Camp-visible Public A2A Message，再为每个 Effective Recipient 创建一个
   Message Delivery；公共-only 请求创建零个 Delivery。
2. Message Delivery 是 recipient-specific 投递、排队、尝试、Context gate、目标 Run 绑定、
   重试和终态的唯一权威。不得引入私有 A2A message、`CampMessageRecipient`、
   `AgentMessageDelivery` 或第二套投递机制。
3. `--to`、严格正文 Addressing Token 和 reply-to default target 在 Core 统一解析。解析失败
   整笔拒绝并返回完整结构化错误；有效集合去重后按 opaque Agent ID 的 UTF-8/ASCII 字节序
   升序冻结。该排序不表达调度优先级。
4. Agent-authored Public A2A Message 进入公共时间线、搜索和 Shared Conversation。回复关系
   只建立公共引用与明确的 reply-to default target，不创建 response obligation、结果回传槽位
   或自动私有闭环。
5. 单次 fanout 受 CampTurn 剩余 A2A budget 与绝对上限 16 约束；A2A lineage 最大深度 5，
   self/ancestor cycle 和预算失败在持久化前原子拒绝。没有语义相似度或时间窗去重。

## Consequences

- 用户和有权 Camp 成员能看到同一条公共协作事实，公共检索和动态上下文不再遗漏 Agent
  handoff；
- Delivery 的队列与终态可按 recipient 独立展示，兄弟目标不会被一个 Runtime 故障隐藏；
- Core、Read Side、CLI、Adapter、审计和 Renderer 必须共同使用同一个 canonical recipient
  snapshot；
- 公共可见性提高了正文治理和引用链预算的重要性，Profile v2 与严格错误合同成为必要配套；
- v0.45 需要 clean-break Schema/Migration，旧 private Member Call 数据不迁移。

## Rejected Alternatives

- **保留 Member Call，额外复制一条公共总结**：会保留两套投递/幂等事实，且公共消息不是
  协作请求本身。
- **每个 recipient 产生一条独立公共消息**：破坏一条用户可见事实与多目标审计的关联，容易
  出现正文/顺序分叉。
- **让 Renderer 解析 Mention 或直接投递**：绕过 Core 的身份、预算、lineage 和唯一 Delivery
  authority，无法 fail closed。
- **按 Agent ID sort 作为执行顺序**：把 opaque identity 的稳定性误当调度策略，限制公平性
  和容量调度。

## References

- [v0.45 版本目标](../versions/v0.45/README.md)
- [Camp Message Send v1](../contracts/camp-message-send-v1.md)
- [Message Delivery v1](../contracts/message-delivery-v1.md)
- [ADR-0131：事件驱动 Delivery 恢复](0131-recipient-scoped-event-driven-delivery-recovery.md)
