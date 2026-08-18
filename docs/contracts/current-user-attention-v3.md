---
document_type: contract
name: Current User Attention
version: v3
status: accepted
source_version: v0.71
last_updated: 2026-08-13
---

# Current User Attention v3

本合同继承 v2 的 `local_user`、Structured Current User Mention、message-local `mentionUser`、精确视口
确认、Markdown 保真和导航失败诚实性，只替代持久 Inbox 呈现及确认 wire。

## 不变语义

- `mentionUser=true` 与 CampMessage、Structured Content、Agent Delivery 和 User Mention Occurrence 在同一
  接受事务提交；普通正文 `@你` 不产生 Mention。
- User attention 与 Agent routing 正交，不创建 Delivery、AgentRun、Task cardinality 或用户批准。
- exact CampMessage read 的 `mentionsCurrentUser`、Context、search、clipboard 和 Renderer token 继续从
  Structured Content 投影。
- 只有精确消息真实进入聚焦可见视口，或用户激活明确代表该消息的 Episode action，才能确认它。

## v3 替代项

v2 的“一条 Mention 一张 Inbox row”改为“一条 Mention 一个 immutable Occurrence；同一 CampTurn 的
Occurrences 共享一张 Episode”。无 CampTurn Mention 按来源消息独立形成退化 Episode。

每条 Occurrence 的 `acknowledgementId` 独立。Episode 选择最早未确认 Mention 作为当前 Mention 摘要和
精确主动作；确认只推进这一条，不确认同 Episode 的其他 Mention。全局 mark-all 是唯一允许跨多个
Occurrence 的显式批量确认，并受 `throughChangeSequence` 限制。

导航 action 绑定观察到的 Episode version。新 Mention 并发到达后，旧 action 仍指向旧卡片明确表示的
消息；Renderer 完成或失败该动作后刷新，不得把目标静默改成新消息。

消息 action 不可用时显示不可用。Core 可同时提供显式 `open_camp_turn` 或 `open_camp` 次动作；Renderer
不能自动执行次动作。用户激活主动作后，即使导航失败，已成功持久化的精确 acknowledgement 不回滚；
只有 acknowledge 命令失败才保留未读。

## References

- [Current User Attention v2（historical）](current-user-attention-v2.md)
- [Notification Episode v3](notification-episode-v3.md)
- [ADR-0165](../versions/v0.65/decisions.md#adr-0165)
- [ADR-0175](../versions/v0.71/decisions.md#adr-0175)
