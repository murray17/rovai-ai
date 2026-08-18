---
document_type: renderer-contract
contract: run-process-detail-surface-v10
authority: agent-process-detail-placement-and-recovery-surface
status: accepted
last_updated: 2026-08-19
---

# Run Process Detail Surface v10（AgentRun 局部停止）

本合同完整继承 [Run Process Detail Surface v9](run-process-detail-surface-v9.md) 的执行台位置、完整 Tool
chronology、公开 Runtime failure、Recovery Blocker、planned-shutdown 与取消活动诚实投影，并新增 User-only
AgentRun 局部停止。它不改变 Composer 的 CampTurn 级停止语义。

## 1. 两级停止入口

- Composer 继续是唯一 CampTurn 级停止入口，停止当前 Turn 的整棵执行树；
- 共享 `ExecutionDrawer` 顶栏在“收起”旁提供唯一 AgentRun 级停止入口，只作用于当前聚焦 Run；
- 底部执行台与右侧 Inspector 继续移动、复用同一个 Drawer、Run selection、确认层和状态投影；
- Camp Header、Task 卡、消息时间线、Composer 与其他详情不得增加 AgentRun 停止入口。

## 2. `agentRuns.cancel`

Renderer 通过现有 User command envelope 调用：

```ts
window.rovai.request('agentRuns.cancel', {
  commandId: string,
  command: {
    campId: string,
    agentRunId: string,
    expectedVersion: number
  }
})
```

Core 只允许本地 User 调用。目标 Run 必须属于 `campId`，处于 `queued | running | waiting`，没有既有
取消请求，不是 `waiting/recovery_blocked`，且所属 CampTurn 没有 Turn-level cancellation。

首次接受只在同一事务中：

```text
agent_run.cancel_requested_at = now
agent_run.cancel_reason_code = user_requested_agent_run_stop
agent_run.version += 1
append agent_run.cancel_requested
```

事务提交后唤醒既有 Runtime cancellation coordinator。该 method 与 `campTurns.cancel` 一样绕过普通 Core
主请求队列；它不创建第二套取消执行器。

命令不得写 `camp_turn.cancel_requested_at`，不得改变 `camp_turn.status`，不得调用
`cancel_pending_turn_deliveries`，不得批量取消兄弟 Run，也不得创建 CampMessage 或公共时间线消息。

同一 `commandId` 重放返回原结果。不同 command 已看到 `cancel_requested_at` 时稳定返回 `accepted`，已看到
终态时稳定返回 `applied`；这两项检查先于 stale `expectedVersion` 拒绝。只有仍可取消且尚未请求停止的 Run
发生版本变化时返回 `command.version_conflict`，不得追加第二个取消事实。

## 3. 立即写入 fence

取消请求提交后，即使 Runtime 进程尚未退出，任何以该 AgentRun 身份授权的新 Camp、Task、Tool 或 A2A
领域写入都必须要求：

```sql
agent_run.cancel_requested_at IS NULL
```

Team Tool、Built-in Tool 与领域 command 的 Run 身份解析必须共享或等价执行该约束。既有 command 的幂等
重放可以返回已经记录的结果，但不得借重放路径准入新的领域写入。

## 4. 取消事实投影

`AgentRunView` 增加独立字段：

```ts
type AgentRunCancelReasonCode =
  | 'camp_turn_cancelled'
  | 'execution_budget_exhausted'
  | 'user_requested_agent_run_stop'

interface AgentRunView {
  cancelRequestedAt: string | null
  cancelReasonCode: AgentRunCancelReasonCode | null
  cancelAcknowledgedAt: string | null
}
```

`cancelReasonCode` 不复用 `terminalReasonCode`。完整 CampSnapshot 使用 Read Model schema 31，Camp Open 使用
[Camp Open Projection v2](camp-open-projection-v2.md)；Renderer 从 Camp Open 构造 Snapshot 时也必须生成 31。

## 5. 停止资格与 Recovery Blocker

```text
canStop =
  status in queued | running | waiting
  && cancelRequestedAt == null
  && waitReason != recovery_blocked
  && CampTurn.cancelRequestedAt == null
```

`waiting/recovery_blocked` 继续只显示既有“结束此运行”。它表达已接受 Runtime 输入但结果未知的用户收口，
可能终结为 `failed / accepted_input_outcome_unknown`，不得与普通取消共用顶栏 Stop 或同时展示两个动作。

## 6. 确认与权威状态

确认层必须读取当前 Run 的 `completionRole`：

- `required`：仅停止此运行，其他已接受的运行继续。此运行停止后将视为必要职责未完成；本轮会在其余职责
  收敛后以“必要职责未完成”失败；
- `optional`：仅停止此运行，其他已接受的运行继续。如果其余必要职责正常完成，本轮仍可完成。

不得宣称停止所有当前 Run 会立即结束 Turn。取消确认后仍由既有 `recompute_camp_turn` 在全部非终态 Run 与
相关非终态 Delivery 收敛后决定终态；required cancelled 得到 `failed / required_run_incomplete`，optional
cancelled 不单独阻止完成。

Renderer 以 Snapshot 为权威，本地状态只覆盖请求和确认延迟：

- 本地刚提交：`正在停止…`；
- Snapshot `cancelRequestedAt != null`：`正在停止…`；
- Snapshot `status == cancelled`：`已停止`；
- 确定性拒绝、版本冲突或已终态：清除本地请求态并刷新 Snapshot；
- 超时、断连或结果不确定：保留 Run-local pending identity，显示“正在确认停止状态”，刷新权威 Snapshot
  后收敛，不先宣称失败，也不恢复为可停止。

`cancellingRunIds` 与 Turn-level `cancellingTurnIds` 分离；需要区分提交中与结果不确定时，使用独立
`confirmingRunIds` 或等价的 per-Run phase，不得从全局错误文本反推。

## References

- [Run Process Detail Surface v9（历史）](run-process-detail-surface-v9.md)
- [Camp Open Projection v2](camp-open-projection-v2.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
- [AgentRun Recovery](../architecture/agent-run-recovery.md)
