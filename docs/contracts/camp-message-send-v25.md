---
document_type: protocol-contract
contract: camp-message-send
version: 25
status: accepted
authority: explicit-message-task-association
source_version: v1.72
last_updated: 2026-10-08
---

# Camp Message Send v25

继承 [v24](camp-message-send-v24.md) 的输入、寻址、发布、回执与幂等合同。
本版补齐 User 消息发送事件的明确 Task 关联，供 [AgentRun Continuation v1](agent-run-continuation-v1.md)
执行已有 Task 准入约束；不改变模型输入、原消息正文或普通 Run 的派发规则。

## 明确关联的持久化

User 发送入口在 `camp_message.sent` 的现有 payload 中保存 `taskId: string | null`：
值来自已通过发送准入的 `execution.taskId`，未指定时为 null。与消息及 waiting Delivery 同事务提交。
Agent Send 已按相同字段保存明确关联，沿用现有写入；不得从正文、当前 Task 列表或发送者职责推导关联。
没有新增用户参数、返回字段、存储表或 Schema 迁移，旧事件不改写。

## 续做准入

batch Run 的单值 `agent_run.task_id` 不承担多输入 Task 关联。提交续做和领取续做请求时，
Core 均通过来源 Run 的全部 `AgentRunInput.message_id` 读取原业务消息的公开发送事件；
不读取本次续做系统操作消息来替代原输入。支持的公开事件种类沿用公共消息 publication 边界。

每个非空 Task 关联都须仍存在于同一 Thread、未完成或取消，且负责人仍是接收成员；
清空负责人同样使关联失效。任一关联失效就拒绝整次续做，或在领取前取消整个 waiting 请求，
不裁掉部分原输入，也不阻塞后面的普通消息。无明确关联的输入保持原规则。

历史事件缺少 `taskId` 时不补造关联，故无法据此核验历史 User 消息当时未持久化的 Task。
这不撤销已有普通执行、不重开 Task、不修改原 Run 终态，也不扩展 Core 的自然语言判断职责。
