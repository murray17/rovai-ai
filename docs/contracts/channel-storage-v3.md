---
document_type: protocol-contract
contract: channel-storage-v3
authority: channel-outbox-abort-retry-suppression
status: accepted
version: 3
source_version: v1.37
last_updated: 2026-09-01
---

# Channel Storage v3

继承 [v2](channel-storage-v2.md) 的凭据、Developer Session、Bot 与存储边界。仅新增
`channel_delivery.retry_suppression_json TEXT NULL`，不增加 Delivery 或 Request 状态。

## 整轮中止

取消的 Turn 先完成 Run/Delivery/Gather 聚合，再由 Core 关闭其 agent_output、agent_attachment 和 attention：

- pending → failed，记录业务中止原因并禁止重试；
- attempting → failed，记录 `channel_delivery_outcome_unknown` 和原 worker/attempt，禁止重试；
- sent 保持 sent，不声称撤回已发出的正文或附件。

suppression JSON 保存 `{reasonCode, workerId, attemptCount, outcomeUnknown}`。已失败项沿用原事实。
ChannelTurnRequest 从 admitted 进入 failed 并结束，FIFO 可继续准入下一根，不等待 Runtime 清理。

## 迟到发送结果与局部停止

原 worker/attempt 的迟到 sent 可将被抑制 delivery 补记 sent 和 external_delivery_message_id，但不能重开
Request、重试、再生成 attachment/attention 或影响下一根。迟到失败不恢复 pending。lease 到期和 claim 都排除
suppression 非空项，Provider 原有去重机制不变。

单 Run 或成员离队不得使用上述整轮关闭：先投影已存在的公开输出，再按原终态规则检查 pending/attempting。
还有合法输出未完成时 Request 继续 admitted；同轮其他队员的输出和附件继续发送。
