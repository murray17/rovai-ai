---
document_type: contract
name: Current User Attention
version: v4
status: accepted
source_version: v0.76
last_updated: 2026-08-14
---

# Current User Attention v4

本合同替代 v3 作为当前 Current User Attention 入口。v3 的 `local_user`、Structured Current User
Mention、message-local `mentionUser`、逐 Occurrence acknowledgement、Episode 聚合、Markdown 保真和
导航失败诚实性继续成立；v4 只扩展“用户已经看见来源”的确认入口。

## 会话可见即精确确认

用户不必通过某个特定提醒动作进入。无论通过侧栏、恢复位置还是应用内提醒打开会话，只要以下条件
同时成立，对应 Active Attention Occurrence 就可以确认：

- Rovai AI 窗口在前台且拥有应用焦点；
- 当前展示“会话”视图，而不是地图、设置或记忆等其他一级页面；
- 精确 Message 节点与会话时间线视口相交；
- 对 CampTurn 终态，至少一个绑定该 `campTurnId` 的精确消息节点可见；
- 对 Approval，仍 pending 的精确审批详情实际展开并进入可见窗口。

“节点可见”不要求把 DOM 键盘焦点强制移到消息上。仅加载 Camp、恢复后台窗口、进入地图、看到屏幕外
历史或只看到收起的审批标题都不能确认。普通进入会话也不能把整个 Camp、Episode 或全部历史批量标记
已读。

Renderer 每次只回报当前可见的稳定来源 ID。Core 以通知 Read Side 已观察到的
`observedThroughChangeSequence` 为上界，只确认同一当前用户、同一 Camp、仍属 Active Attention 且在该
边界内已 admitted 的精确 Occurrence。边界之后新到达的 Mention、本轮结果或审批保持未读，即使复用了
相同 CampTurn。

确认成功后 Renderer 立即重读轻量未读状态；命令失败时保留未读并在来源仍可见时有界重试。命令按
occurrence disposition 幂等，重复可见性报告不得创造新的注意力或重复业务效果。生产 Renderer 暂不
展示全局通知总数，但 Core unread 事实仍用于避免无未读时提交可见来源命令。

## 显式通知动作

v3 的显式 action 语义保持不变：激活明确代表某个 Occurrence 的 action 时可先持久化该精确
acknowledgement，导航失败不回滚；普通 `open_camp` 仍不代表任何屏幕外来源。进入会话后的自动确认由
上述可见来源合同独立决定，不从 Episode 的 `primaryAction + secondaryActions` 推断全部来源。

## References

- [Current User Attention v3 (historical)](current-user-attention-v3.md)
- [Notification Episode v4](notification-episode-v4.md)
- [ADR-0165](../adr/0165-core-owned-current-user-message-attention.md)
- [ADR-0175](../adr/0175-core-owned-notification-occurrence-episode-and-change-journal.md)
