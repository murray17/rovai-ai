---
document_type: contract
contract: durable-task-v3
status: accepted
target_version: v0.54
last_updated: 2026-08-11
---

# Durable Task v3

本合同冻结 v0.54 起当前 Task authority、字段 mutation 与 Camp-wide read wire shape。领域理由见
[ADR-0152](../adr/0152-lead-owned-task-responsibility-and-self-active-task-awareness.md)。v2 仅保留
historical 解释，不是当前 Runtime、CLI 或恢复兼容入口。

## Task 定位

Task 是跨 AgentRun 持续存在、具有明确 owner、可独立完成、阻塞或交接的责任单位。创建者应优先
推进或扩展已有 Task；普通分析、咨询、一次性 review、工具操作、local plan、A2A 请求和一个 Task
内部的执行步骤不得持久化为新 Task。该语义约束属于 `team.create_task` 的 Lead-facing contract；Core
只执行确定性的 authority、shape、state、version 与 capacity 校验，不做语义去重。

## AgentRun instruction boundary

Task-linked responsibility admission 只冻结 Task identity、version 与 Assignee 审计事实，不复制 Task
全文。触发 CampMessage 或 ConversationMessage 的正文是该 AgentRun 唯一的自然语言执行指令，并以
`CURRENT_INPUT` 交付；`purpose` 只保留为 Core 审计与责任描述。AgentRun 不保存或暴露
`expectedOutput`，也不根据自由文本输出条件判断成功。该边界由
[ADR-0157](../adr/0157-message-owned-agentrun-instruction-without-expected-output.md)局部替代
ADR-0137 的旧 instruction ownership 条款。

## Create

`team.create_task` 只允许 User 或当前 Camp Default Lead。Agent 调用还必须来自当前 Camp 的有效、
未 fenced AgentRun；普通 Agent 返回 `task.create_forbidden`。输入必须显式提供当前 CampMember
`assigneeAgentId`，不得为 `null` 或省略。初态固定为 `pending`，创建不会发送 CampMessage、启动或
唤醒 Assignee。

责任定义字段为：`title`、`description`、有序 `acceptanceCriteria` 与 `assigneeAgentId`。User/Lead
拥有这些字段以及 release、reassign、`pending`、`cancelled` 的控制权。

## Assignee execution-state update

当前 Assignee 可通过同一个 `team.update_task` 原子修改自己的执行状态与匹配说明：

| 当前 | 允许目标 |
| --- | --- |
| `pending` | `in_progress`、`blocked`、`completed` |
| `in_progress` | `blocked`、`completed` |
| `blocked` | `in_progress`、`completed` |

同一 `blocked` 状态可更新 `blockedReason`。进入 `blocked` 必须有非空 `blockedReason`；进入
`completed` 必须仍有明确 `assigneeAgentId` 且有非空 `completionSummary`；离开对应状态清除其说明。
unassigned recovery Task 必须先重新分配，不能由 User/Lead 直接宣告 completed。Assignee 不得修改 title、
description、Acceptance Criteria、assignment、release、reassignment、cancelReason，不得返回
`pending`、取消、认领 unassigned Task 或修改他人 Task。包含任一越权字段的 patch 整体返回
`task.update_forbidden`，不会部分应用。所有更新继续使用 `expectedVersion`；terminal Task 不可变。

User/Lead 可以在 Task 非终态时原子更新责任定义、assignment 与状态，但仍须满足 projected final
state：unassigned 只能是 `pending`，清除 Assignee 必须得到 `pending`，状态说明必须与最终状态匹配。

## Unassigned

Create 不产生 unassigned Task。`assigneeAgentId: null` 只可能来自 User/Lead 显式 release 或当前
CampMembership 结束时的恢复收口。它不是共享队列，不可由普通 Agent claim，保持 `pending` 直到
User/Lead 显式分配。

## Read side

当前、有效且 fenced 到该 Camp 的每个 Agent 可读取该 Camp 全部 Task；User 亦可读取。ID 不构成
跨 Camp capability，stale/fenced/cross-Camp 请求 fail closed。

`team.list_tasks` 每项只有：

```json
{
  "taskId": "task_…",
  "title": "…",
  "status": "blocked",
  "assigneeAgentId": "agent_…",
  "availableActions": ["update"]
}
```

`assigneeAgentId` 在 holding/recovery state 可为 `null`。List 不返回 description、AC、version 或审计
字段；需要 mutation 的调用者必须先 `team.get_task` 取得完整当前 `TaskDetail` 与 version。

`availableActions` 只可能是 `[]` 或 `["update"]`：User/Lead 对非终态 Task 得到 `update`；当前
Assignee 对自己的非终态 Task 得到 `update`；其他情况为空。

> availableActions is advisory capability metadata. Core authorization and field-level mutation rules are authoritative.

List/Get 是只读操作，不产生审计写入、轮询或 Task freshness watermark。

## Capacity 与 lifecycle

每 Camp 最多 512 个非终态 Task；每 source AgentRun 最多创建 32 个 Task。它们只是安全上限，不是
创建建议。Task 与 Camp 级联删除；membership removal 释放未完成 assignment；Task-linked Run 的
已接受责任准入继续使用 admission 时冻结的 Task version/Assignee，不被后续变更 retarget。
