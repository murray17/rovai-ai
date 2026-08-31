---
document_type: protocol-contract
contract: cancellation-settlement-v1
authority: agent-run-and-camp-turn-abortive-settlement
status: accepted
version: 1
source_version: v1.37
last_updated: 2026-09-01
---

# Cancellation Settlement v1

本合同拥有取消的业务线性化点和 Runtime 清理边界。用户命令保留 User authority、Camp scope、
`expected_version` 和 DomainCommandGateway 幂等；内部 Runtime 清理不使用领域 ACK 命令。

## 业务事务

- Run 取消调用 `settle_abortive_agent_run_in_tx`；关闭其 Action、Approval、Runtime Delivery、Input 与已物化
  Message Delivery，清除 wait/recovery/lease，再按既有聚合规则重算所属 Turn。
- 确定未发送、未发生效果的 Run 为 `cancelled`；accepted/unknown Input、已经开始 dispatch 的 prepared Input、
  可能执行的 Action 或正在递交的 Runtime Delivery 为 `failed / accepted_input_outcome_unknown`，
  `manual_retry_allowed = false`。未知证据保留；终态不代表回滚。
- Turn 取消写入原有取消 intent，调用 `settle_abortive_camp_turn_in_tx`，关闭该 Turn 的 pending Delivery、
  Gather/item，结算所有非终态 Run，然后聚合一次。预算到期保留 budget exhaustion 原因。
- 返回 `Applied` 时已经提交业务终态。Run payload 含 `agentRunId/campTurnId/status/campTurnStatus`；
  Turn payload 含 `campTurnId/campTurnStatus/runs`，每个 Run 带实际 `terminalStatus` 和清理目标。
- 已终态重复取消为 Applied no-op，不改变终态或版本；同 command replay 仍返回原结果。活跃对象的版本冲突仍拒绝。
- 只有整轮取消、预算终止、Camp 删除或应用退出能抑制整轮渠道投递。单 Run 取消和成员离队只走正常 Turn 聚合。

## Runtime 清理

复用 `ExecutionLaunchPermit`、`PlannedShutdownCoordinator.active` 与 `ActiveExecutionKey`。Run 注册 active
时持有同一个取消 token，任何可能创建 Runtime 的 launch 之前必须注册；发送、会话创建和 binding 交接必须检查
取消与现有 authority。已受理但未物化 handle 的 launch 仍是活跃清理对象，不能据 handle 缺失宣称清理完成。

一次清理总 deadline 为三秒，包含 token、协议 interrupt、ingress flush、detach、受管进程强制终止和 reap。
interrupt/flush 不能耗尽强制回收预算。进程回收未确认时保留原 lease/active 关联；后台可继续重试，业务终态不变。
仅确认清理后按 Run ID + execution epoch 条件写 `cancel_acknowledged_at`，不推进 Run version、聚合 Turn 或创建
`runtime-cancellation-ack` command receipt。普通 terminal/callback 不得删除仍需清理的 active 记录。

同一 Conversation 的新 Run 在旧清理未确认时最多等待上述期限，随后终态
`failed / runtime_cleanup_unconfirmed`，`manual_retry_allowed = true`。不无限 queued、不允许不明旧进程与新 Run
同时执行。此边界不新增 project lock、依赖图、PID 数据库或每 Run worktree，也不影响其他 Conversation。

## 旧半取消恢复与迁移

只有打开目标 Camp 或该 Camp 已排队的渠道输入准备准入时，针对该 Camp 的 cancel-marked 未收口对象执行同一
结算事务。普通 waiting/recovery 不属于补偿范围。没有命中时不写数据；不读取 event_log、不全库扫描历史 Camp。

Migration 134 从精确 `v1.43 / schema 84` 升级为 `v1.44 / schema 85`，仅增加 Input dispatch timestamp、
Channel retry suppression 及窄索引。非终态 Run 的旧 prepared 没有发送边界证明，迁移为 delivery_unknown；
accepted 和已终态 Run 的历史证据不改写。迁移 DDL、状态转换、marker、receipt 同事务，失败全部回滚。

具体 Input、membership、Channel、shutdown、删除和 UI 规则分别由本次更新的专属合同拥有。
