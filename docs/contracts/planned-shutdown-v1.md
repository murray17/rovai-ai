---
document_type: runtime-contract
contract: planned-shutdown-v1
authority: planned-core-shutdown-wire-terminal-binding-and-settlement
status: accepted
last_updated: 2026-08-12
---

# Planned Shutdown v1

## 1. Scope 与 Main-only request

本合同只覆盖 Desktop 主动退出、主动重启和更新前重启。Core crash、SIGKILL、系统强杀和断电不进入本
协议。Electron Main 向 Core stdio 发出：

```json
{
  "id": 41,
  "method": "core.shutdown",
  "params": {
    "protocolVersion": 1,
    "deadlineMs": 10000
  }
}
```

`protocolVersion` 必须为 `1`；`deadlineMs` 是 Core monotonic drain window，固定产品值为 `10000`，测试可
在 `100..30000` 内覆盖边界。该 method 只加入 Main 的 `CoreMethod` 类型，不进入 Preload API、Renderer
IPC allowlist 或 Agent Built-in catalog。

Core 完成 drain、route fence、Runtime reap 和 worker 收口后返回：

```json
{
  "protocolVersion": 1,
  "status": "completed",
  "deadlineExpired": false,
  "activeExecutionsObserved": 2,
  "stopRequestsIssued": 2,
  "terminalExecutionsSettled": 2,
  "unresolvedExecutions": 0
}
```

`status` v1 固定为 `completed`，`deadlineExpired` 说明 drain window 是否耗尽；它不改变未解决 Run 的领域
状态。Core 写出 response 后 flush stdout 并自行退出。相同 Desktop `CoreClient` 的重复 shutdown 调用只
复用原 Promise，不发送第二个 wire request。

## 2. Execution 与 terminal admission

`beginDrain` 之后不得有任何 Run 新跨过 claim、Runtime acquire、input prepare 或 prompt send。
已经进入 launch critical section 的执行必须完成以下二者之一后才能释放 permit：

- 注册匹配当前 generation 的 active handle，并完成 prompt-send handoff；
- 在 input 尚未 accepted 时安全失败并持久化普通 preflight/launch 结果。

draining 期间 CampMessage、Action/Approval 结果、Runtime Delivery、Runtime Input ACK 和 terminal
transactions 仍允许写入；这些写入产生的 queued Run 只留待下一次启动。shutdown request 之前已经进入
Main background request set 的工作必须在统一 deadline 内等待收口；超时中止不构成 Runtime terminal proof，
也不能把关联 Run 写成 failed 或 cancelled。它们与 planned stop 和 terminal 等待并行排空，不得被 Core 作为
向 active execution 发出 planned stop 的前置 barrier。

deadline 到达时必须按顺序关闭 terminal guard 创建、等待已进入事务完成、关闭并排空 live
Runtime route callback、fence Built-in lease，再 reap Runtime。每个 Codex/ACP callback 以及 one-shot
acceptance/terminal 提交都必须先进入该 route admission；围栏后的排队事件不得再写领域状态。
guard 之外的 Git observation、Skill/MCP cleanup 和 Renderer event emit 不参与 drain。

## 3. Same-generation terminal binding

可靠 terminal observation 必须匹配：

```text
coreGeneration
+ liveRuntimeRouteIdentity
+ agentRunId
+ executionEpoch
+ adapterTurnCorrelation
+ providerTurnId, when available
```

`cancelled` 还必须匹配 `plannedStopRequested = true`。interrupt request/response、process exit、signal、route
detach、reap 或 shutdown transport error 均不是 terminal observation。

相同 binding 与相同 terminal fingerprint 的重复观察返回既有结算；相同 binding 的不同 terminal outcome
必须以 `agent_run.conflicting_runtime_terminal` fence，不得覆盖既有终态。

## 4. AgentRun terminal fields

Migration 77 为 `agent_run` 增加 nullable closed projection：

```text
terminal_resolution_source = runtime_terminal
terminal_reason_code = planned_shutdown_completed
                     | planned_shutdown_failed
                     | planned_shutdown_cancelled
```

字段与 AgentRun terminal update 在同一事务写入。历史终态和非 planned-shutdown 路径允许两个字段为空；
普通 Runtime terminal 写 `runtime_terminal` 且 reason 为空，不能由 Renderer 从事件猜测。没有 Provider/
Adapter terminal observation 的 Core preflight 或 launch failure 不得写 `runtime_terminal`。

planned-shutdown `failed` 保留 Adapter 冻结的 `last_error_code`、detail 和 `manual_retry_allowed`；Core 不把
所有 failure 假设成可 retry。`cancelled` 写 `manual_retry_allowed = 0`。accepted Runtime Input Delivery
保持原证据。

## 5. Abortive settlement

私有 abortive settlement 只接受 generation-local terminal guard，不是公共 DomainCommand。`failed` 与
`cancelled` 在一个事务内：

1. 可能已经 dispatch 的 Action → `unknown/active`，`resolution_source` 继续为 `reconciler`；
2. 未 dispatch 的 Action → `not_executed`；
3. pending Approval → `cancelled/planned_shutdown_runtime_terminal`；
4. pending/delivering/failed Runtime Delivery → `safely_closed`；
5. prepared Runtime Input → `not_accepted`，accepted / delivery_unknown 不改写；
6. 写 AgentRun terminal、只结算其 `target_agent_run_id` 对应 Delivery、重算 CampTurn。

`failed` Delivery 沿用 `status=failed`，failure detail 包含 Run error 与 terminal reason；`cancelled` Delivery
写：

```text
status = cancelled
failure_code = target_agent_run_planned_shutdown_cancelled
```

兄弟 Delivery、同 Turn queued/waiting Run 与 CampTurn cancellation intent 均不得被修改。

## 6. CampTurn aggregate

Migration 77 为 `camp_turn` 增加 nullable `aggregate_reason_code`。聚合顺序继续保留 execution budget、
Message Delivery failure 和 manual retry authority，但满足：

- 仅 `cancel_requested_at IS NOT NULL` 可产生 `CampTurn.status=cancelled`；
- 没有 Turn cancellation 时，非终态 Run/Delivery 继续使 Turn 为 running/waiting；
- required failed 且 manual retry 尚可用、未 decline → waiting；否则 → failed；
- required cancelled → failed，`aggregate_reason_code=required_run_incomplete`；
- optional failed/cancelled 不阻止 completed；由该 optional target terminal 派生的 Delivery failed/cancelled
  也不能反向把同一责任重新升级为 required failure。

状态或原因变化都增加 CampTurn version 并发出 `camp_turn.status_changed`；离开对应原因时必须清空旧值。

## 7. Desktop watchdog

`CoreClient.shutdown()` 在发送前设置 stopping，清除 restart/stable timer，并保留 child 引用以等待真实 exit。
Desktop outer watchdog 使用 `Core deadline + 3000ms` 后发 SIGTERM，再等待 `2000ms` 才可 SIGKILL。正常
report、stdin/child exit 或 watchdog fallback 都必须让 Promise 最终 settle；shutdown 开始后任何 exit 都
不得触发 Core 自动重启。

## 8. Renderer 关闭等待面

Main 进入 controlled shutdown 后发布本地 `runtime.state=shutting_down`；Renderer 显示不可取消的
modal 等待面，明确说明系统正在等待可靠 Runtime terminal，无法确认的执行会保留现场。v1
不显示倒计时、继续等待、强制退出或取消退出控件。Dialog 必须有稳定的 accessible name /
description，在 Day/Night、`1040×700`、200% zoom 和 reduced motion 下保持可读。
