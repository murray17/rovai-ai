---
document_type: contract
name: Single Chat
version: v3
status: accepted
source_version: v1.54
last_updated: 2026-09-07
---

# Single Chat v3

继承 [v2](single-chat-v2.md) 的私有路由、结束、FIFO、Context/Built-in policy、附件及目标代次 fence。
本版本为本机 Owner 恢复单聊注意力，作为 v2 中通用 Notification 排除的唯一例外；公共消息、Agent Context、
A2A / Gather / Channel 的私有内容排除不变。

`SingleChatRunView` 增加必需 `campTurnId: string`。`SingleChatSnapshot` 增加必需
`approvals: ActionApprovalView[]`，只包含该精确 Conversation 的 pending 审批。Renderer 复用现有审批组件，
通知只定位审批详情，用户仍须显式选择原 native option。

通知使用原始 Conversation / Run ID，只读取 `singleChat.get` 和活动列表，不调用会创建 successor 的
`singleChat.open`。缺失、结束、成员离开 / 不可用或审批已处理时明确失败；迟到读取仍受目标代次限制。
卡片、类别偏好和可见来源确认由 [Notification Episode v6](notification-episode-v6.md) 与
[Current User Attention v5](current-user-attention-v5.md) 定义。
