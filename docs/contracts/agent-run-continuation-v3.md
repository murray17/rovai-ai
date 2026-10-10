---
document_type: protocol-contract
contract: agent-run-continuation-v3
authority: user-authorized-independent-run-continuation
status: accepted
version: 3
source_version: v1.72
last_updated: 2026-10-10
---

# AgentRun Continuation v3

继承 [v2](agent-run-continuation-v2.md) 的授权、幂等、FIFO、cleanup、输入范围和自动会话选择，
替代 v1 中公开系统操作消息的要求。User 点击继续只产生内部授权和 waiting Delivery。

## 内部操作与公开读取

新请求不创建 camp_message、不推进 last_message_sequence、不发布 camp_message.sent 或消息变更通知。
现有 camp_message_delivery 使用 source_kind 区分普通消息和续做：普通来源必须有 message_id，
续做来源的 message_id 必须为空，授权与原 Run 来源仍由 camp_run_continuation 保存。
新 Applied 回执 payload 为 `{threadId, deliveryId}`；已有幂等回执按原字节回放。

Desktop/Web 消息列表、分页、定位、查找和 Agent 历史均没有新续做记录；其他系统消息和已有记录保持。
单一 FIFO 由 Camp 的 last_delivery_sequence 分配，独立于公共消息序号。领取前照常重验原 Run 的业务输入、
Task 和成员资格；新 Run 只领取完整原业务输入，公开边界仍取现有 last_message_sequence。

## 排队投影与锚点

thread.runs 字段保持；queued messageCount 统计业务输入次数，续做按来源 Run 的完整输入数量计数，
重复请求分别计数。队首预览取其首条业务输入，并沿用既有历史可见性规则；已创建 Run 的返回保持。
Desktop Delivery 保留 continuationRequest，以首条原输入作为 messageId，并用可选 inputMessageIds
提供完整有序输入。Run inputMessageIds、anchorMessageId、用户锚点导航和直接回复预览沿用原规则。

## 历史记录与证据

Migration 190 / schema 140 收敛内部队列来源与序号，既有续做 Delivery 转为无消息外键的内部来源。
主干此前的 188 / schema 138 已具有该结构；同号 Preview 收据拥有直接回复索引与 Runtime catalog。
升级按实际完整结构区分两种来源，保留旧收据；已具备内部请求结构时不重建队列，补齐保留的 ACP 身份。
已生成的公开记录不批量删除、隐藏或改写索引；原事件、旧 Run、冻结 Manifest、Runtime 输入和工具回执保留。
未领取请求继续排队，不重新授权、不重复发布。旧 Core 拒绝新 schema。
模型模板、字段和会话兼容版本轴保持，不清空原生会话。范围与前后对照见
[r3](../versions/v1.72/model-context-change-quiet-continuation.md)。
