---
document_type: protocol-contract
contract: agent-run-continuation-v5
status: accepted
version: 5
source_version: v1.72
last_updated: 2026-11-19
---

# AgentRun Continuation v5

继承 [v4](agent-run-continuation-v4.md) 的 User、成员、公开会话、来源 Run、冻结输入及清理资格。

用户对停止或失败的公共 batch Run 点击继续，Core 在同一命令事务内按来源输入的 ordinal
将各条消息送回原队员的普通队列。消息和队员已有 waiting 投递时复用该 ID。命令返回
`{threadId, agentRunId, deliveryIds}`，实体引用是来源 `agent_run`。deliveryIds 按来源 ordinal
包含复用和新建项。相同 commandId 返回原回执。领取后再次主动点击可产生新的普通等待项。

同队员的所有普通等待项按消息 sequence、投递 queue_sequence 排序。调度领取上下文预算内的有序前缀，
最后入选的消息是锚点。队首预览按相同顺序取首条。编辑、改投、删除由普通消息重排处理。
`canContinue` 仅取决于来源资格及既有输入过大例外。`hasAcceptedContinuation` 表示该来源全部普通输入
都在同队员队列中按对应版本等待。领取后执行条使用现有最新 Run 规则。

会话选择与普通执行相同。旧命令字段 `useNewSession` 可传，Core 忽略其值。普通 Runtime 在派发前
恢复会话失败的降级与当前执行清理门禁继续生效。历史终态、输入 ordinal 及原生接收证据可继续读取。

迁移 231 / schema 181 按旧等待项当前有效输入清单转换，重叠项按消息与队员去重。历史的内部 Delivery
保留原身份及终态，执行列表读取历史 Run，消息回执只读取关联实际消息的投递。模型输入例见
[批次顺序对照](../versions/v1.72/model-context-change-ordinary-redelivery.md)。
