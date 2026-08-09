---
document_type: interface-contract
contract: durable-task-v2
authority: durable-task-domain-contract
status: accepted
version: 2
last_updated: 2026-08-08
---

# Durable Task v2 Contract

本合同冻结 v0.47 起 Task 的字段、状态、授权、可见性、事务、列表投影、CampMember 关系结束与收口，
以及 Task-linked responsibility admission。设计理由见
[ADR-0136](../adr/0136-durable-task-v2-responsibility-and-coordination-authority.md)与
[ADR-0137](../adr/0137-one-time-task-linked-responsibility-admission.md)；Agent CLI 的 wire、
stdout 和版本矩阵由 [Built-in Tool Transport v4](builtin-tool-transport-v4.md)负责。

这是 clean-break 合同。旧四态 Task、旧输入字段、旧结果形状和旧 Rovai-owned Task 数据
不迁移、不回填、不翻译。

## 1. 领域边界

Task 是一个 Camp 内的持久责任记录，只拥有范围、负责人、业务状态和关闭事实。三个层次
必须保持独立：

| 层次 | 权威事实 |
| --- | --- |
| Task | 持久责任、负责人、范围、状态与关闭说明 |
| `camp.message.send` / `rovai send` | 公共通知与显式 A2A 委派 |
| AgentRun | 执行生命周期、Runtime 状态与运行证据 |

以下行为不属于 Task：

- 创建、分配或更新 Task 后自动通知、唤醒或启动 Agent；
- `send` 后自动变为 `in_progress`；
- AgentRun 成功后自动完成 Task，或失败后自动阻塞 Task；
- 在 Task 中保存 Runtime 权限、预算、沙箱、优先级、截止时间、依赖图、进度百分比；
- 增加 `complete_task`、`claim_task`、`block_task`、`cancel_task` 或 `delete_task`；
- 存放任意 evidence/result JSON 容器。

Acceptance Criteria 是有序文本条件，不跟踪逐项完成状态。`completed` 是获授权 actor 的
完成声明，不表示 Core 已验证测试、质量、Acceptance Criteria 或用户验收。

## 2. Canonical operation 与说明

| Canonical operation | CLI |
| --- | --- |
| `team.create_task` | `rovai task create` |
| `team.get_task` | `rovai task get` |
| `team.update_task` | `rovai task update` |
| `team.list_tasks` | `rovai task list` |

Catalog 使用下列稳定说明；命令帮助可以更短，但不得改变语义：

### `team.create_task`

> Create a durable Camp responsibility only when the work must remain visible across messages,
> AgentRuns, or handoffs. Do not create Tasks for private plans or transient reasoning steps.
> Assignment records ownership but does not notify, wake, or start the assignee.

### `team.get_task`

> Read one complete Task currently visible to this Agent by stable Task ID. Missing and unauthorized
> Tasks are both reported as not found. Use this command to obtain the current version and full
> content before updating a known Task. This command is not a waiting primitive.

### `team.update_task`

> Atomically update an authorized non-terminal Task using its current version. Core validates the
> final projected state. In-progress and blocked Tasks require an assignee; blocked Tasks require a
> blocker; completed Tasks require a completion summary; cancelled Tasks require a cancellation
> reason. Updating a Task does not notify, wake, or start a member.

### `team.list_tasks`

> Discover a bounded page of compact Task summaries visible to this Agent. Use rovai task get for
> full content. This command is not a waiting primitive and must not be repeatedly polled.

## 3. 规范化与计数

除非某字段另有说明，所有文本限制都在 trim 后按 Unicode scalar value 计数。Core 存储 trim
后的值；限制不按 UTF-8 byte、token 或 UI 截断长度计算。`null` 只在合同明确允许时有效，
不得把 `null` 当作 omitted。

Acceptance Criteria 的共同规范为：

| 项目 | 规则 |
| --- | --- |
| 项数 | 最多 12 项；更新时提供数组则必须为 1–12 项 |
| 单项 | trim 后 1–500 字符 |
| 总字符数 | 所有规范化项目合计不超过 6,000 字符 |
| 重复 | 任意两个规范化项目完全相同时拒绝整个请求 |
| 顺序 | 按调用者定义顺序保存和返回 |
| 更新 | 全量替换，不支持逐项 patch |

## 4. Create

`team.create_task` 的闭合输入对象为：

| 字段 | 必填 | 规则 |
| --- | --- | --- |
| `title` | 是 | trim 后 1–160 字符 |
| `description` | 否 | trim 后最多 8,000 字符；省略或纯空白存为 `""` |
| `acceptanceCriteria` | 否 | 0–12 项；省略存为 `[]`，显式 `[]` 允许 |
| `assigneeAgentId` | 否 | 非空 Agent ID，必须是 Current CampMember |

Create 不接受 `status`，也不接受 `assigneeAgentId: null`。初始状态固定为 `pending`，
`version = 1`，所有条件说明与 Closure Metadata 为 `null`。

User 与当前 Camp 中的 eligible Agent 可以创建 Task。System actor 不得创建业务 Task。固定
Built-in operation 的发布不受 per-Member Task Capability gate 控制；Core 仍必须校验认证 AgentRun、
当前 Camp、Current CampMembership 和其他独立调用资格。

Create 事务同时实施两个容量边界：

| 边界 | 上限 |
| --- | ---: |
| 单个 Camp 的非终态 Task 总数 | 512 |
| 单个 source AgentRun 创建的 Task 总数 | 32 |

非终态只包括 `pending | in_progress | blocked`。User 创建没有 source AgentRun，因此不消耗
per-AgentRun 计数；Agent 创建必须记录 `sourceAgentRunId` 并消耗对应计数。检查和写入在同一
事务完成，竞争请求不能共同越过上限，也不能通过完成旧 Task 重置单个 AgentRun 的累计创建数。

## 5. Get

`team.get_task` 的闭合输入对象只含必填非空 `taskId`。Core 以认证调用者的当前 Camp 和
第 9 节可见性规则读取一个 Task。下列情况统一返回 `task.not_found`：

- Task 不存在；
- Task 属于其他 Camp；
- Task 存在但调用者不可见。

响应不得透露隐藏 Task 的 Camp、状态、负责人、terminal 属性或 version。Get 返回第 8 节完整
`TaskDetail`，是读取已知 Task 最新 version 的入口；它不是等待或轮询 primitive。

## 6. Update 输入与 patch

`team.update_task` 的闭合输入对象为：

| 字段 | 必填 | 规则与语义 |
| --- | --- | --- |
| `taskId` | 是 | 非空字符串 |
| `expectedVersion` | 是 | integer，`>= 1` |
| `title` | 否 | trim 后 1–160 字符 |
| `description` | 否 | trim 后最多 8,000 字符；`""` 清空 |
| `acceptanceCriteria` | 否 | 1–12 项，按第 3 节全量替换 |
| `clearAcceptanceCriteria` | 否 | 只有 `true` 表示清空；`false` 不构成 patch |
| `status` | 否 | `pending | in_progress | blocked | completed | cancelled` |
| `assigneeAgentId` | 否 | 非空 Agent ID，必须是 Current CampMember |
| `clearAssignee` | 否 | 只有 `true` 表示清除负责人；`false` 不构成 patch |
| `blockedReason` | 条件字段 | trim 后 1–4,000 字符 |
| `completionSummary` | 条件字段 | trim 后 1–4,000 字符 |
| `cancelReason` | 条件字段 | trim 后 1–4,000 字符 |

互斥关系：

- `assigneeAgentId` 与 `clearAssignee: true` 互斥；
- `acceptanceCriteria` 与 `clearAcceptanceCriteria: true` 互斥。

除了 `taskId`、`expectedVersion` 和值为 `false` 的清除标志，请求必须至少包含一个实际 patch
字段。下列输入显式无效：

```text
assigneeAgentId: null
acceptanceCriteria: null
acceptanceCriteria: []
blockedReason: null
completionSummary: null
cancelReason: null
```

清除负责人必须使用 `clearAssignee: true`，清除 Criteria 必须使用
`clearAcceptanceCriteria: true`；v2 不提供 nullable patch alias。

## 7. 状态机与 projected final state

状态集合是闭合五态：

```text
pending | in_progress | blocked | completed | cancelled
```

允许的迁移矩阵为：

| 当前状态 ↓ / final 状态 → | `pending` | `in_progress` | `blocked` | `completed` | `cancelled` |
| --- | :---: | :---: | :---: | :---: | :---: |
| `pending` | 允许 | 允许 | 允许 | 允许 | 允许 |
| `in_progress` | 允许 | 允许 | 允许 | 允许 | 允许 |
| `blocked` | 允许 | 允许 | 允许 | 允许 | 允许 |
| `completed` | 禁止 | 禁止 | 禁止 | 禁止 | 禁止 |
| `cancelled` | 禁止 | 禁止 | 禁止 | 禁止 | 禁止 |

Core 先将规范化 patch 应用于当前快照，再校验 projected final state。不能只检查调用者显式
传入的 `status`，也不能为了满足约束自动改变调用者没有请求的状态。

| Projected final status | 必须满足 |
| --- | --- |
| `pending` | Assignee 可为 `null` 或 Current CampMember |
| `in_progress` | Assignee 非 `null` |
| `blocked` | Assignee 和 `blockedReason` 均非 `null` |
| `completed` | `completionSummary` 与全部 Closure Metadata 完整 |
| `cancelled` | `cancelReason` 与全部 Closure Metadata 完整 |

共同不变量：

- final status 不是 `blocked` 时，`blockedReason == null`；
- final status 不是 `completed` 时，`completionSummary == null`；
- final status 不是 `cancelled` 时，`cancelReason == null`；
- final status 非终态时，全部 Closure Metadata 为 `null`；
- `clearAssignee: true` 时，final status 必须为 `pending`。

从 `in_progress` 或 `blocked` 释放责任必须在同一个 patch 中至少提交：

```json
{"status":"pending","clearAssignee":true}
```

只提交 `clearAssignee: true` 给 `in_progress` 或 `blocked` Task 必须拒绝。

条件字段按以下规则处理：

- 首次进入 `blocked` 必须提供 `blockedReason`；已经处于 `blocked` 且只改其他字段时不用重传；
  可在保持 `blocked` 时替换；离开 `blocked` 时 Core 自动清空；final status 非 `blocked` 时输入
  `blockedReason` 必须拒绝。
- `completionSummary` 只允许在非终态进入 `completed` 时写入；它说明完成内容、交付位置和
  已知限制，不构成自动验证。
- `cancelReason` 只允许在非终态进入 `cancelled` 时写入；Task terminal 后不可修改。

Closure Metadata 全部由认证 actor 与 Core 时间派生，不得成为输入：

| 字段 | 派生规则 |
| --- | --- |
| `closedByType` | `user | agent` |
| `closedById` | 认证关闭主体 ID |
| `closedByAgentRunId` | Agent 关闭时为当前 source AgentRun；User 关闭时为 `null` |
| `closedAt` | Core 生成的 date-time |

## 8. 稳定结果形状

所有 `TaskDetail` 属性始终存在；不适用的标量用 `null`，Acceptance Criteria 用数组：

| 字段 | 类型 |
| --- | --- |
| `taskId` | `string` |
| `campId` | `string` |
| `title` | `string` |
| `description` | `string` |
| `acceptanceCriteria` | `string[]` |
| `status` | 五态 enum |
| `assigneeAgentId` | `string | null` |
| `blockedReason` | `string | null` |
| `completionSummary` | `string | null` |
| `cancelReason` | `string | null` |
| `createdByType` | `user | agent` |
| `createdById` | `string` |
| `sourceAgentRunId` | `string | null` |
| `closedByType` | `user | agent | null` |
| `closedById` | `string | null` |
| `closedByAgentRunId` | `string | null` |
| `version` | integer，`>= 1` |
| `createdAt` | date-time |
| `updatedAt` | date-time |
| `closedAt` | `date-time | null` |
| `availableActions` | `("update" | "claim")[]` |

Agent-facing Task 字段统一使用 `taskId`，不得混用 `id`。Task mutation canonical result 是平铺
对象，不使用 `{ "task": { ... } }` wrapper：

| Operation | Core canonical result |
| --- | --- |
| `team.create_task` | 完整 `TaskDetail` |
| `team.get_task` | 完整 `TaskDetail` |
| `team.update_task` | 完整 `TaskDetail` 加必填 `changed: boolean` |
| `team.list_tasks` | `TaskListPage` |

Create/update 的 compact Agent stdout 由 Transport v4 另外定义，不能反向删减 Core canonical
result 或持久 command result。

## 9. 读取可见性、更新权限与 availableActions

读取范围为：

| 调用者 | 可见 Task |
| --- | --- |
| User | 当前 Camp 全部 Task |
| Default Lead | 当前 Camp 全部 Task |
| 普通 Agent | 当前分配给自己的、未分配的、以及自己创建的 Task |
| System actor | 无 business Task 读取权 |

Creator visibility 持续存在，但 creator 身份本身不产生更新权限。更新权为：

| 调用者 | 权限 |
| --- | --- |
| User | 更新当前 Camp 任意非终态 Task，包括取消 |
| Default Lead | 更新当前 Camp 任意非终态 Task，包括取消；不因此获得通用管理员权限 |
| 普通当前 Assignee | 修改内容、转交给 Current CampMember、释放责任，或进入 `pending / in_progress / blocked / completed` |
| 普通 Agent + unassigned Task | 只能以同一次 update 原子认领给自己；可同时改内容，projected final status 仅限 `pending / in_progress / blocked` |
| Creator-only | 对已分配给他人的 Task 无更新权 |
| System actor | 无 business Task mutation authority |

普通 Agent 不得使 projected final state 成为 `cancelled`。无法继续时使用 `blocked`；不再承担
责任时原子提交 `status=pending + clearAssignee=true`。Claim 限制检查整个 projected final
state：即使调用者没有直接传 terminal `status`，任何字段组合都不能让同一次
`unassigned → self` 认领落到 `completed` 或 `cancelled`。

`availableActions` 是 advisory projection，不是第二套命令或授权真源：

| 调用者和当前 Task | 值 |
| --- | --- |
| User / Default Lead + 非终态 | `["update"]` |
| 普通当前 Assignee + 非终态 | `["update"]` |
| 普通 Agent + unassigned 非终态 | `["claim"]` |
| 只有 creator visibility | `[]` |
| 任意 terminal Task | `[]` |

Claim 仍通过 `team.update_task` 完成；不存在 `claim:<agentId>` 动态 action，也不恢复 per-Member Task
Capability gate。

## 10. Update 授权与校验顺序

Core 必须按以下可观察顺序处理 update：

1. 使用 `taskId + authenticated currentCampId` 加载候选 Task；
2. 判断第 9 节读取可见性；
3. 对不存在、跨 Camp 或不可见统一返回 `task.not_found`；
4. 检查 terminal，不允许重开或修改；
5. 判断 actor 对这类普通更新或 claim 是否有权；
6. 校验 `expectedVersion`；
7. 规范化输入；
8. 计算 projected final state；
9. 校验状态、Assignee、条件字段、取消和 claim 不变量；
10. 检测 no-op；
11. 原子持久化结果。

因此不可见 Task 不会泄露 terminal、version、Assignee 或 Camp。对可见 Task，旧
`expectedVersion` 即使最终 patch 是 no-op 也必须返回 `task.version_conflict`。

稳定错误至少包含：

| Code | 场景 | Recovery |
| --- | --- | --- |
| `task.not_found` | 不存在、跨 Camp 或不可见 | `stop` |
| `task.terminal` | 可见 Task 已是 terminal | `stop` |
| `task.update_forbidden` | 可见 Task 但 actor 无该 mutation 权 | `stop` |
| `task.version_conflict` | `expectedVersion` 过期 | `refresh_then_decide` |
| `task.assignee_unavailable` | 目标不是 Current CampMember | `fix_input` |
| `task.capacity_exceeded` | Camp 已有 512 个非终态 Task | `stop` |
| `task.create_limit_exceeded` | source AgentRun 已创建 32 个 Task | `stop` |
| `task.invalid_cursor` | list cursor 无效 | `fix_input` |

输入 shape、文本限制、互斥规则、状态字段组合或 projected final state 无效时使用该 operation
闭合错误合同中的 `builtin_tool.invalid_input → fix_input`。错误详情不得绕过第 5、9、10 节的
可见性边界。

## 11. No-op 与 mutation 事务

规范化后使用以下业务字段比较当前快照与 projected snapshot：

```text
title
description
acceptanceCriteria
status
assigneeAgentId
blockedReason
completionSummary
cancelReason
```

完全相同时返回普通成功和 `changed: false`；不增加 version，不改变 `updatedAt`，不写 domain
event。仍要持久化完整 command result，使相同 command Replay 返回同一结果；不得返回
`task.no_change`。

Create/update 必须在同一数据库事务中：

1. 校验 actor、Camp、权限、容量和 version；
2. 规范化输入，计算并校验 projected final state；
3. 检测 no-op 并在需要时写 Task；
4. 从本次事务提交的确切版本构造完整 `TaskDetail` 和 `availableActions`；
5. 将完整 canonical result 写入 `CommandHandlerResult.payload`；
6. 由 Command Gateway 持久化 result、event、receipt 所需事实并一起 commit。

禁止 commit 后重新调用 live `get_visible_task` 拼接 mutation result；后续并发更新不能污染本次
响应或幂等 Replay。Applied update 增加 version、更新 `updatedAt` 并写一次 Task event；进入
terminal 时同一版本冻结 Closure Metadata。

## 12. 紧凑列表

`team.list_tasks` 的闭合输入为：

| 字段 | 必填 | 规则 |
| --- | --- | --- |
| `statuses` | 否 | 1–5 个去重五态值；默认 `pending / in_progress / blocked` |
| `assigneeAgentId` | 否 | 非空 Agent ID，仅按负责人过滤 |
| `unassignedOnly` | 否 | 只有 `true` 表示只返回未分配 Task |
| `limit` | 否 | integer 1–100，默认 50 |
| `cursor` | 否 | 非空 opaque string |

`assigneeAgentId` 与 `unassignedOnly: true` 互斥。不得以 nullable filter 替代
`unassignedOnly`。

`TaskListPage` 的稳定形状为：

```ts
type TaskListPage = {
  tasks: TaskListItem[];
  nextCursor: string | null;
  truncated: boolean;
};
```

`TaskListItem` 为：

| 字段 | 类型与限制 |
| --- | --- |
| `taskId` | string |
| `title` | string |
| `status` | 五态 enum |
| `assigneeAgentId` | `string | null` |
| `createdByType` | `user | agent` |
| `createdById` | string |
| `descriptionPreview` | 最多 240 字符 |
| `descriptionTruncated` | boolean |
| `acceptanceCriteriaCount` | integer 0–12 |
| `statusNotePreview` | `string | null`，最多 240 字符 |
| `statusNoteTruncated` | boolean |
| `version` | integer |
| `createdAt` | date-time |
| `updatedAt` | date-time |
| `availableActions` | `("update" | "claim")[]` |

`statusNotePreview` 来源固定为：

| Status | Source |
| --- | --- |
| `pending` | `null` |
| `in_progress` | `null` |
| `blocked` | `blockedReason` |
| `completed` | `completionSummary` |
| `cancelled` | `cancelReason` |

List 不返回完整 description、Acceptance Criteria 内容、完整状态说明、source AgentRun 或
Closure Metadata。专用 SQL projection 必须在数据库中完成 visibility、status 与 Assignee
filter，只读取 preview 所需字符，以 `limit + 1` 判断下一页，并保持
`createdAt DESC, taskId DESC`。不得先加载全部 `TaskDetail` 再在应用层过滤。

## 13. CampMembership ending 与永久删除

Member Presence `present → away` 不结束 CampMembership，也不释放 Task；负责人仍承担责任，
只是当前不是 Executable Assignee。

当一个 CampMembership `active → left` 时，同一 membership mutation 事务必须释放该队员在
该 Camp 负责的全部非终态 Task：

| 原状态 | 新状态 |
| --- | --- |
| `pending` | `pending` |
| `in_progress` | `pending` |
| `blocked` | `pending` |

每个被释放 Task 同时设置：

```text
assigneeAgentId = null
blockedReason = null
version += 1
updatedAt = Core time
audit cause = assignee_membership_ended
```

Core 写每项 membership/Task audit，但不写 CampMessage、不创建新 Task 卡、不自动转交 Default
Lead，也不把该副作用解释为 System actor 获得 Task mutation authority。Terminal Task 不修改，
保留历史 Assignee。

`RemoveMember` 先统计该 AgentProfile 的 `queued | running | waiting` AgentRun。计数大于 0 时以
既有 `agent_profile.non_terminal_runs` 安全边界拒绝。计数为 0 时，即使 Profile 仍属于多个
Camp，也必须在一个数据库事务中：

1. 枚举其全部 Current CampMembership；
2. 对每个 Camp 调用同一内部 membership-ending 领域逻辑，完成 membership closure、上述 Task
   释放、Default Lead successor/reconcile 和各类 audit；
3. 所有 Camp 成功后才把 AgentProfile 标记为 `removed`；
4. 任一步失败则全部回滚，不留下部分 Camp 已退出而 Profile 未删除的状态。

Task 释放的直接原因始终是 CampMembership ending；单 Camp leave 与 `RemoveMember` 只是两个
上层入口。Removal preview 至少返回：

```ts
type MemberRemovalPreview = {
  nonTerminalAgentRunCount: number;
  currentCampMembershipCount: number;
  openAssignedTaskCount: number;
  defaultLeadCampCount: number;
};
```

已接受但尚未 materialize 的 A2A Delivery 不属于非终态 AgentRun gate。Profile 删除后，它可因
recipient 不再满足当前 membership/Presence execution eligibility 而停止 materialization；原因是
身份永久移除，不是 Task 状态变化。

## 14. 一次性 Task-linked responsibility admission

新 Task linkage 只在责任被持久接受的原子边界准入一次：

| 路径 | Admission boundary |
| --- | --- |
| Direct linked execution | 关联 queued AgentRun 被原子创建的事务 |
| A2A linked execution | MessageDelivery responsibility 被持久接受的事务 |

Admission 时必须同时满足：

- Task 属于同一 Camp；
- Task status 是 `pending` 或 `in_progress`；
- target recipient 是 Task 当前 Assignee；
- 该 Assignee 是 Executable Assignee，即 Current CampMember 且 Member Presence 为 `present`；
- 该执行路径自己的其他接受条件成立。

被接受的 responsibility 至少持久化以下审计事实：

```text
taskId
taskVersionAtAdmission
assigneeAgentIdAtAdmission
```

不冻结 Task 全文。实际执行指令继续由 message、purpose、expectedOutput 和对应执行合同拥有。

责任一旦被接受，后续 Task 变为 `blocked / completed / cancelled`、改派、释放、修改 title、
description 或 Acceptance Criteria，都不得仅凭该变化使已接受 Delivery、queued AgentRun 或
running AgentRun 失败、取消、重定向或停止 materialization。Dispatch/start 不得再次检查：

```text
recipient == Task current assignee
Task current status admits execution
```

Dispatch/start 仍重新检查独立执行资格，包括 Current CampMembership、Member Presence、Runtime
readiness、Delivery/AgentRun/CampTurn cancellation、execution budget、lease/scheduler fencing、
A2A lineage/capacity 以及 permission/safety constraints。这些条件可独立等待、失败或取消。

因此 terminal Task 只禁止接受新的 task-linked responsibility，不撤销历史责任；改派给 B 不会
把已接受给 A 的责任重定向给 B。若协调者要停止 A，必须使用现有 Delivery、AgentRun 或
CampTurn cancellation。Task `cancelled` 表示持久责任终止，不是历史执行撤销 primitive。

## 15. Clean break 与非 Task 投影

v0.47 直接采用五态 schema 与本合同字段，不迁移 v0.46 Task、旧 command result、旧 catalog
或旧 replay 记录。Reset 只能按 [ADR-0118](../adr/0118-v041-local-data-clean-break-and-managed-reset-boundary.md)
清理 Rovai-owned App data，不得触碰用户 workspace、外部 Runtime Home/config/credentials 或
外部 MCP state。

Task Detail 可以关联 audit、AgentRun 和 Delivery，但这些关系不成为 `TaskDetail`/TaskRecord
字段，也不能反向改变 Task。Renderer 的 Related execution 区域从 CampSnapshot 现有 Run 与
Delivery 关系派生；Task 与执行必须能显示为两个同时成立的事实，例如
`Task = completed` 与 `AgentRun = running`。

## References

- [ADR-0136: Durable Task v2 Responsibility and Coordination Authority](../adr/0136-durable-task-v2-responsibility-and-coordination-authority.md)
- [ADR-0137: One-Time Task-Linked Responsibility Admission](../adr/0137-one-time-task-linked-responsibility-admission.md)
- [Built-in Tool Transport v4](builtin-tool-transport-v4.md)
- [Message Delivery v1](message-delivery-v1.md)
- [Camp Message Send v2](camp-message-send-v2.md)
- [v0.47 version overview](../versions/v0.47/README.md)
