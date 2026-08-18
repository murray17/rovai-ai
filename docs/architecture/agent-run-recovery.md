---
document_type: architecture
architecture: agent-run-recovery
authority: agent-run-session-and-native-turn-recovery-boundaries
last_updated: 2026-08-13
---

# AgentRun Recovery

本文描述 Core 重启后 AgentRun、Native Session 与 Native Turn 的长期恢复边界。规范依据是
[Runtime 恢复与关闭不变量](foundational-invariants.md#runtime-recovery-shutdown)。受控关闭后的 product
fence 由 [Runtime 恢复与关闭不变量](foundational-invariants.md#runtime-recovery-shutdown)拥有；字段级状态与命令见
[Accepted Input Recovery v1](../contracts/accepted-input-recovery-v1.md)与
[Planned Shutdown v2](../contracts/planned-shutdown-v2.md)。

## 1. 三个独立恢复对象

```text
AgentRun durable state
  ├─ Native Session binding：可 load/resume 或安全替换
  ├─ Runtime Input Delivery：prepared / accepted / delivery_unknown 证据
  └─ Native Turn：Provider 侧一次 prompt 的运行与 terminal result
```

Core 拥有 AgentRun 和 Runtime Input Delivery；Runtime Provider 拥有 Native Session 与 Native Turn。
Session 恢复只重新建立会话 handle，不能恢复旧 Host 内存中的 prompt route。只有经验证的 Adapter
`native_turn.reconcile.v1` 才能把同一旧 Turn 重新对账。

## 2. 启动恢复分类

Core 在普通 Startup Recovery Coordinator 之前先检查 pending `planned_shutdown_cycle`。cycle 覆盖的
AgentRun 通过 durable product fence 直接收敛为 terminal cancelled，同时保留 accepted/delivery-unknown
input 与 unknown external effects；它们不进入下面的普通分类，也不会恢复旧 Run 执行权。

没有 pending controlled-shutdown cycle 时，Startup Recovery Coordinator 在同一事务内先收敛 Action、
Approval、Runtime Delivery 和 prepared input，再分类 AgentRun：

- 无 accepted input 且没有其他 safety blocker：可以保持 `runtime_session_recovery` 语义，由 Scheduler
  领取并执行安全的 Session 恢复；
- 输入投递结果未知：保持 `delivery_unknown`，不得猜测 accepted 或未发送；
- 存在 accepted input，且不存在更具体的未决 Approval、Action、Runtime Delivery、prepared 或
  delivery-unknown input：进入 `waiting/recovery_blocked`；
- 存在 active unknown Action：继续由 Action Reconciler 拥有，不被 accepted-input blocker 覆盖。

`recovery_blocked` 的 `runtime_recovery_required` 必须为 false。第二次启动不得重新标记为自动恢复，
不得增加 execution epoch，也不得改变 accepted Delivery。

## 3. 调度与 Adapter 边界

Scheduler 只领取 queued，或确有自动动作的 `waiting/runtime_recovery` Run。accepted input filter 保留为
纵深防御；`recovery_blocked` 永不进入候选集合。Codex/ACP Adapter 遇到既有 accepted Delivery 时必须
fail closed，不得发 `agent_run.input_resumed` 或等待一个不存在的旧 Host response route。

未来若某 Adapter 通过 P1 实验，Core 才能为它增加独立的 `native_turn_reconciliation` 状态与 Coordinator。
该 Coordinator 只能 lookup/reattach 同一 Provider Turn，不能调用新的 prompt API。

## 4. 用户与预算收敛

Renderer 从 Snapshot 读取 blocker，不推断恢复进度。用户执行
`agentRuns.resolveRecoveryBlocker` 后，Core 原子写入：

```text
AgentRun.status = failed
last_error_code = accepted_input_outcome_unknown
manual_retry_allowed = false
accepted Runtime Input Delivery = unchanged
CampTurn = recomputed
```

CampTurn Stop 与 Execution Budget 到期经 cancellation coordinator 走相同 Run 终态；Stop 可使 CampTurn
整体成为 cancelled，预算到期使其成为 failed，但 blocker Run 本身始终保留 outcome unknown。用户若要
继续，必须检查 Workspace/Git/外部效果现场并发送新的后续任务；Core 不自动创建 successor。

## 5. 证据与观测

- `accepted` 回执证明 Runtime 接受过输入，不证明模型读取、工具完成或 terminal result；
- Runtime correlation ID 不自动升级为 Provider Turn ID；
- Execution Evidence、ContextManifest、Git Observation 和 Workspace 现场不因 blocker resolution 删除；
- UI 的“结果待确认”是领域状态投影，不是 Runtime 正在执行恢复动作的动画状态。
