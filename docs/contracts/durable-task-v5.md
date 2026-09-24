---
document_type: contract
contract: durable-task-v5
status: accepted
target_version: v1.67
last_updated: 2026-09-23
---

# Durable Task v5

继承 [v4](durable-task-v4.md) 的 Camp 范围、责任定义、读取可见性、正文合成、状态机、权限和终态规则。
本版删除 **Task 对象版本机制**。旧合同作为历史解释，不再作为当前输入或输出。

## 输入与字段更新

`team.update_task` 的闭合输入为 `taskId`，加可选 `title`、`description`、`status`、
`assigneeAgentId`/`clearAssignee`、`blockedReason`、`completionSummary`、`cancelReason`。
Host `tasks.update` 使用相同业务字段，归属补丁表示为 `assignee: unchanged | assign | clear`。
两个入口都没有 `expectedVersion`；收到该旧字段须拒绝，而不是自动代填。

Core 在同一事务中读取当前 Task、验证 actor 与状态，然后只应用显式提交的字段。未提交字段保持当前值；
同字段由以后成功提交的事务覆盖。改变状态时，旧状态专属说明按状态机清理；状态与说明校验、
Assignee 准入、终态不可变和全部字段写入仍是一个原子事务。命令 ID 和请求摘要的幂等保持。
`task get` 可以用于理解当前业务内容，不是更新前置条件。

## 当前 Task 与执行关联

Core、Host、Desktop/Web 当前 Task 对象包含业务、归属、状态说明、创建与关闭审计、时间字段；
**不包含 `version`**。当前 `task` 表没有版本列；AgentRun 与 Delivery 只保留 Task ID 和接纳时
Assignee ID，不保存 Task version。`task.updated` 事件也不产生版本字段。历史事件与冻结 JSON 原样保存。

## Agent 四类输出

| 操作 | Agent 输出 |
| --- | --- |
| `create` | `taskId, title, status, assigneeAgentId` |
| `get` | `taskId, title, description, status, assigneeAgentId`；仅 blocked/completed/cancelled 时增加对应说明 |
| `update` | create 四字段加 `changed` |
| `list` | `tasks[]` 每项为 create 四字段；外层 `nextCursor, truncated` |

四类输出均不含 `version`、`availableActions`。Core 的 canonical/UI 投影可继续提供建议性的
`availableActions`，但真实权限始终由调用时 Core 校验。Agent 输入输出与 UI 对象不得把建议当作授权。

## 数据与恢复

Migration 171 删除当前 Task 与关联执行的 Task 专属版本列，复制业务行并校验外键；不改写历史审计
或冻结输入。旧版本化 payload 不提供转换、双读、兼容解码或自动重播；新执行使用新结构。
