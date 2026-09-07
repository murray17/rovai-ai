---
document_type: contract
name: Current User Attention
version: v5
status: accepted
source_version: v1.54
last_updated: 2026-09-07
---

# Current User Attention v5

继承 [v4](current-user-attention-v4.md) 的本机 Owner、精确可见来源、冻结水位 / UUID 和显式动作语义。
当前阅读区域细化为公屏与独立 Single Chat Conversation：同 Camp 的公屏、不同成员单聊、同成员后续单聊
都不能代替原 Conversation。单聊面板打开时，后台公屏不作为当前阅读区域。

公屏回报可见 Message ID；终态以可见回复节点的 CampTurn ID 确认，用户输入节点不能证明看见执行结果。
单聊回报可见终态摘要 / 最终回复的 CampTurn ID，以及展开且可见的 pending Approval ID。只加载 Snapshot、
显示成员名、阅读旧消息或收起审批均不构成确认。阅读旧消息时新回复通过对话内入口呈现，不抢滚动位置。

两种 surface 的精确来源集合由 Controller 合并，复用 `acknowledgeVisibleSources` 的当前用户、Camp、
Active Attention 与 observed-through 校验；没有新的 Camp 级批量已读。当前对话完成抑制只是 heads-up
策略，不改变未读。前后台变化和来源失效规则由 [Notification Episode v6](notification-episode-v6.md) 拥有。
