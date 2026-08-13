---
document_type: adr
id: ADR-0175
title: Core-Owned Notification Occurrence, Episode and Change Journal
status: accepted
date: 2026-08-13
decision_scope: cross-version
source_version: v0.71
supersedes: []
superseded_by: null
---

# ADR-0175: Core-Owned Notification Occurrence, Episode and Change Journal

## Context

ADR-0087 的一来源一行 Inbox 能持久化通知，却无法在不丢失每条 Mention 精确确认的前提下，把同一
CampTurn 的 Mention 与终态表达成一件用户事项；只轮询新建行也看不到 Episode 升级、解决或清除后
重新出现。Renderer 聚合会复制领域规则，并让迟到的 read/clear 吞掉并发更新。

## Decision

Core 以三层通知模型替代旧 Inbox row：不可变 NotificationOccurrence 记录每个合格来源事实；独立
Disposition 记录 acknowledge/satisfy/resolve；materialized NotificationEpisode 按 CampTurn、无 Turn
消息或 Approval generation 聚合成一张卡片；最小 NotificationChangeJournal 为增量和 heads-up 提供
全局单调边界。来源事实、Occurrence、Episode upsert 与 Journal append 在同一 SQLite 事务提交。

Episode 的 `episodeVersion` 与 `attentionRevision` 分离。前者覆盖所有持久语义变化，后者只覆盖新注意
事项；clear through attention revision，因此 Camp 改名、availability、acknowledge 或 resolve 不会复活
已清除事项。所有 acknowledge、clear 和 mark-all 写入都绑定用户观察边界。

Core Read Side 拥有 closed display semantics、原因计数和状态、排序、当前最早未确认 Mention、类型化
主/次 action 及各自 availability。Renderer 只拥有本地化、布局和动作执行，不按 Camp 或时间重新聚合，
也不从标题推断 locator。普通 Agent 公屏消息继续只在 Camp 时间线，不形成通知。

本决定细化 ADR-0087 和 ADR-0165；两者关于 SQLite 真源、来源事务、Current User identity、Structured
Content 和 Agent routing/User attention 正交性的其余条款保持有效。v2 的 per-message Inbox row 由
Current User Attention v3 替代，不原地修改 ADR-0165。

## Consequences

- 同一 Episode 可以升级且仍逐条确认 Mention；迟到命令不能吞掉新 revision。
- Renderer reload 从 Inbox high-water 开始，不补弹历史；运行中更新由 Journal 精确驱动。
- Core Schema、JSON-RPC、TypeScript、Renderer 和设置必须一次 clean break，旧通知数据与偏好不迁移。
- Journal 需要 floor/reset/retention；可重新出现 Episode 不再适用 clear 一天后删除。

## Rejected Alternatives

- **Renderer 聚合旧行。** 会复制优先级、确认和并发语义，多个窗口无法共享真源。
- **Episode 一个 readAt。** 会让新 Mention 或部分确认吞掉同 Episode 的其他来源。
- **Journal 保存完整 read view。** 会复制可变标题、正文和 availability，并形成第二份历史真源。
- **用 episodeVersion 清除。** 非注意力呈现变化会错误复活已清除事项。
- **迁移未上线旧数据。** 扩大双读/回填代码而没有用户价值；v0.71 采用通知域 clean break。

## References

- [Notification Episode v2](../contracts/notification-episode-v2.md)
- [Current User Attention v3](../contracts/current-user-attention-v3.md)
- [ADR-0087](0087-core-owned-durable-in-app-notification-inbox.md)
- [ADR-0165](0165-core-owned-current-user-message-attention.md)
