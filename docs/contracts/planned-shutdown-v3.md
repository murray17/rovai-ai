---
document_type: runtime-contract
contract: planned-shutdown-v3
authority: planned-core-shutdown-cancel-all-durable-intent-and-settlement
status: accepted
last_updated: 2026-08-27
---

# Planned Shutdown v3

Planned Shutdown v3 把 Rovai 主动退出、重启和更新统一定义为：取消所有非终态 AgentRun，完成本地
收口，然后退出。它继承 v2 的 Main-only ownership、durable shutdown cycle、generation-local admission、
unknown-effect 保留、启动补偿和 Desktop watchdog；本合同只替换 terminal 优先级、取消审计、时限与 report。
v1、v2 均为历史合同；当前 Desktop 与 Core 只接受 v3，不协商混合版本。

## 1. Request 与 durable intent

Electron Main 发送：

```json
{
  "id": 41,
  "method": "core.shutdown",
  "params": {
    "protocolVersion": 3,
    "deadlineMs": 10000
  }
}
```

Core 只接受 protocol version `3`。在关闭内存 launch admission 前，Core 先以当前 generation 持久化
`planned_shutdown_cycle`。因此已经跨入 launch handoff、但尚未完成 route binding 的 Run 仍属于同一次
cancel-all intent；若当前进程在事务收口前中断，下一 generation 在普通恢复前继续同一 cycle。

Migration 113 把该表的 protocol constraint 从仅 v2 扩为 `2 | 3`，不改写既有行，也不改变当前 Data
Contract 与 projection schema marker。v2/v3 共存只用于历史 pending cycle 补偿；新的 shutdown request 只写 v3。

同 generation 重复记录必须幂等；不同 protocol 冲突必须拒绝。历史未结 v2 cycle 仍按 v2 规则补偿，
不得在升级时伪装成新的 v3 用户取消审计。

## 2. Cancel-all cutoff

Core 关闭 launch admission、停止新的调度与恢复 launch，并完成已进入 handoff 的 writer barrier。取得稳定
active snapshot 后，Core 立即关闭 Terminal Settlement Admission 与 Live Runtime Route Admission。这个
cutoff 是“退出即取消所有 AgentRun”的 generation-local 线性化点：

- cutoff 前已经取得 guard 的 terminal 或 callback 可以完成并排空；
- cutoff 后任何 Runtime terminal、工具结果、公开消息或 callback 都不能赢过 cancel-all settlement；
- Core 不再为取得可靠 Runtime terminal 预留等待窗口；
- Core 向 snapshot 中的 active Runtime 并发发送原生 interrupt/cancel，但它只是尽力停止进程，不拥有
  AgentRun 终态；实现只给该控制动作 `600ms` grace；
- Runtime teardown 在产品事务后另有最多 `2s` 的有界 reap grace，不能重新打开领域写入。

interrupt 未确认、进程尚未退出或 Runtime 没有返回 terminal，都不阻止产品侧取消。它们只影响进程回收与
外部效果确定性。

## 3. AgentRun cancellation settlement

Core 关闭 Built-in Tool listener、fence invocation gate，并 abort/drain 已跟踪的 AgentRun、event、后台请求
与 Runtime usage writer。只有这些 writer fence quiesce 后，Core 才以一个 immediate transaction 结算当前
cycle。事务选择全部 `queued | running | waiting` AgentRun，并写入：

```text
status = cancelled
wait_reason = null
runtime_recovery_required = false
execution lease = cleared
manual_retry_allowed = false
ended_at = settlement time
terminal_resolution_source = null
terminal_reason_code = null
last_error_code = planned_shutdown_cancelled
               | planned_shutdown_outcome_unknown
```

v3 同时形成 Run-local 取消审计：若该 Run 尚无显式取消请求，则写入 cycle 的 `requested_at`、
`cancel_reason_code = app_shutdown_cancel_all`，并追加 `agent_run.cancel_requested`；无论请求来自既有显式操作
还是本次退出，事务都写入 `cancel_acknowledged_at` 和 `agent_run.cancelled`。既有更具体的取消 reason 保留，
不得被退出覆盖。

产品取消不等于 Runtime terminal，也不等于外部效果回滚。事务继续执行 v2 的 obligation fence：

- 可能已派发 Action → `unknown/active`，继续由 reconciler 拥有；
- 确定未派发 Action → `not_executed`；
- pending Approval → 以受控关闭原因取消；
- unfinished Runtime Delivery → `safely_closed`；
- accepted 与 delivery-unknown Runtime Input → 保留；
- prepared Runtime Input → `delivery_unknown`；
- AgentRun、目标 Message Delivery、CampTurn aggregate 与 shutdown cycle → 同一事务收口。

v3 不写 `camp_turn.cancel_requested_at`。它等价于逐个取消 AgentRun，而不是停止整个 CampTurn：required Run
被取消时，未另有 CampTurn Stop intent 的 Turn 仍进入 `failed / required_run_incomplete`；optional Run 的取消
不阻止其他职责正常聚合。

## 4. Startup compensation

Core 启动后、普通 `prepare_v2_recovery` 前，按 request 顺序结算所有 pending shutdown cycle。v3 cycle 使用
第 3 节同一事务并补齐取消审计；v2 cycle 保持历史 product-fence 语义。补偿必须幂等：

- settled cycle 不重复应用；
- 已终态 Run 不改变；
- 原 input 不发送、不恢复、不复制到 successor；
- terminal cancelled Run 不进入 Runtime recovery、delivery-unknown waiting 或 recovery blocker；
- 后续 Skill/MCP 清理不得重开 Run。

## 5. Read model 与 Renderer

v3 结算的 Run 是普通 terminal `cancelled`。存在 accepted/delivery-unknown input 或 unknown Action 时，Read Side
独立投影 `hasUnsettledExternalEffects = true`，Renderer 显示“外部效果待确认”，不显示 spinner、恢复动作或
自动重试，也不声称回滚。

Renderer 收到 `runtime.state = shutting_down` 后立即阻止新的界面交互，但前 400ms 不显示关闭反馈；若 App
在门槛内完成收口则直接退出，不闪现等待面。超过门槛后显示无操作按钮的 modal：标题为“正在安全退出”，
说明 Rovai 正在保存本地状态并关闭后台服务；若有尚未完成的 AgentRun，将一并取消，未确认的文件、命令或
工具效果会保留为待核对记录。modal 必须可聚焦、标记为 busy modal dialog，并在 reduced-motion 下停用
indeterminate motion。`shutting_down` 之后 Renderer 不再发起页面投影刷新，也不把取消结算产生的晚到请求
拒绝显示为错误横幅或 Toast；安全退出 modal 是该阶段唯一的操作状态反馈。

## 6. Report 与 deadline

v3 response：

```json
{
  "protocolVersion": 3,
  "status": "completed",
  "deadlineExpired": false,
  "activeExecutionsObserved": 2,
  "stopRequestsIssued": 2,
  "terminalExecutionsSettled": 0,
  "cancelledAgentRunsSettled": 2,
  "unsettledEffectAgentRuns": 2,
  "controlledShutdownCyclePersisted": true,
  "unresolvedExecutions": 0
}
```

`terminalExecutionsSettled` 只统计 cutoff 前已取得 guard 并成功提交的 terminal race；它不代表 v3 等待过
Runtime。`cancelledAgentRunsSettled` 统计本次 cancel-all transaction 收口的 Run，包括 active registry 外的
queued/waiting Run。`unsettledEffectAgentRuns` 是其中保留未知效果的子集。

正常 v3 settlement 即使使用 cancel-all fallback，`deadlineExpired` 也应为 `false`。只有 launch/writer guard
没有及时 quiesce、durable transaction 未完成、进程 reap 超过自己的有界 grace 或触及 hard deadline 时才为
`true`。`unresolvedExecutions` 在成功产品事务后必须为零；未知外部效果不属于非终态执行。

## 7. Desktop boundary

Electron Main 是唯一调用方。第一次 `before-quit` 保留等待面，`CoreClient.shutdown()` 发送一次 v3 request、
禁止自动重启、等待 report 和 child 真实 exit；重复调用复用同一个 Promise。Core hard deadline 仍为 `10s`，
Desktop outer watchdog 只在 Core 失去响应时执行平台级强制结束。正常活跃 Run 路径的 acceptance 目标是
`5s` 内自然退出；这不是增加第二个领域 deadline。

## References

- [Planned Shutdown v2 (historical)](planned-shutdown-v2.md)
- [Planned Shutdown architecture](../architecture/planned-shutdown.md)
- [Runtime recovery and shutdown invariants](../architecture/foundational-invariants.md#runtime-recovery-shutdown)
- [AgentRun Recovery](../architecture/agent-run-recovery.md)
- [V1.29-D07](../versions/v1.29/decisions.md#v1-29-d07)
