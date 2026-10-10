---
document_type: protocol-contract
contract: message-delivery
version: 12
status: accepted
authority: public-message-delivery-route-reconciliation
source_version: v1.72
last_updated: 2026-10-10
---

# Message Delivery v12

继承 [v11](message-delivery-v11.md) 的单一 FIFO、独立续做批次、原输入集合、路由与事件唤醒。
按 [Continuation v3](agent-run-continuation-v3.md)，队列来源明确为 message 或 continuation：
普通消息必须有 message_id，续做必须为空，并通过 camp_run_continuation 保存原 Run 来源。
Camp 的 last_delivery_sequence 独立分配 queue_sequence；续做不产生消息记录或公开消息序号。
原业务输入被删除／撤回、成员或 Task 失效仍按原准入取消。
普通 Delivery 仍排除 tombstone；续做读模型提供完整原输入 ID 并保留独立批次和原消息定位。
Migration 188 保留旧公开消息与所有冻结证据，仅转换内部来源结构与 FIFO 计数器。
