---
document_type: runtime-contract
contract: accepted-input-recovery-v1
authority: accepted-runtime-input-restart-classification-and-user-convergence
status: accepted
last_updated: 2026-08-12
---

# Accepted Input Recovery v1

## 1. 状态合同

Core 启动时，满足以下全部条件的 AgentRun 必须进入 Accepted-Input Recovery Blocker：

- Run 非终态，启动 recovery 已将其规范化为 `waiting/runtime_recovery`；
- 当前 Run 至少存在一条 `runtime_input_delivery.status = accepted`；
- 没有 pending Approval；
- 没有 prepared/executing Action，也没有 active unknown Action；
- 没有 pending/delivering/failed Runtime Delivery Checkpoint；
- 没有 prepared 或 delivery-unknown Runtime Input Delivery；
- 没有 cancellation request。

原子结果为：

```json
{
  "status": "waiting",
  "waitReason": "recovery_blocked",
  "runtimeRecoveryRequired": false,
  "lastErrorCode": "accepted_input_outcome_unknown"
}
```

execution epoch、accepted Delivery、ContextManifest、Execution Evidence、Workspace 与 Git observations 不变。
重复 startup recovery 必须为 no-op。该 Run 不可被普通 Scheduler 领取、Runtime rebind 或 recovery
marking 改回自动恢复。

## 2. 用户命令

Renderer 允许调用：

```json
{
  "method": "agentRuns.resolveRecoveryBlocker",
  "params": {
    "commandId": "uuid",
    "command": {
      "campId": "camp-id",
      "agentRunId": "run-id",
      "expectedVersion": 12
    }
  }
}
```

只有本地 User actor、精确 Camp、精确 version、`waiting/recovery_blocked`、无 cancellation request、
accepted input 仍存在且无其他 terminal safety blocker 时可应用。成功结果 code 为
`agent_run.accepted_input_outcome_unknown`，并把 Run 原子收敛为：

```json
{
  "status": "failed",
  "waitReason": null,
  "runtimeRecoveryRequired": false,
  "lastErrorCode": "accepted_input_outcome_unknown",
  "manualRetryAllowed": false
}
```

命令通过既有 Command Gateway 按 commandId 幂等 replay。stale version、错误 Camp、非 blocker、accepted
evidence 缺失或并发 cancellation 必须 rejected；不得静默接受另一状态。

## 3. Stop 与预算

当 blocker 已收到 CampTurn cancellation 或 Execution Budget exhaustion，Cancellation Coordinator 仍可 ACK，
但 Run 结果必须是 `failed/accepted_input_outcome_unknown`，不能改写为普通 cancelled。accepted input 保留，
不增加 epoch、不创建 prompt、不自动 successor。CampTurn 按自己的 cancel/budget authority 重算终态。

## 4. 事件与 Read Side

- startup summary 增加 `acceptedInputRecoveryBlockersCreated`；
- blocker resolution 写入 `agent_run.accepted_input_outcome_unknown` domain event；
- cancellation worker 向 Renderer 发 `agent_run.recovery_blocker_resolved`，显式用户命令由命令响应后刷新；
- CampSnapshot 不增加字段或 schema 版本，只通过既有 `status`、`waitReason` 和 version 投影 blocker；
  terminal outcome-unknown 由命令结果 code 与 `agent_run.accepted_input_outcome_unknown` timeline event 审计。

## 5. 禁止行为与未来能力

禁止把 accepted input 改回 prepared/delivery-unknown、自动重发、增加 execution epoch、伪造 final output、
标记 succeeded，或仅凭 `session/load` 发出“input resumed”。未来 `native_turn.reconcile.v1` 不属于本合同的
P0 实现；它必须先通过
[Copilot Native Turn Reconciliation 实验](../versions/v0.64/copilot-native-turn-reconciliation-experiment.md)。
