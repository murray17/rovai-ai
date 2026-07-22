---
document_type: adr
id: ADR-0004
title: "Action & Safety"
status: accepted
date: 2026-07-20
decision_scope: cross-version
source_version: v0.02
supersedes: []
superseded_by: null
---

# ADR-0004: Action & Safety

## Context

v0.01 将 Approval 与 Native Request 绑定，但“授权”“是否派发”“是否发生”“结果是什么”和“Runtime 是否收到结果”分散在请求、事件和进程内状态中。崩溃发生在任意边界时，系统无法可靠区分未执行、已执行、结果未知或结果尚未返回 Runtime。

## Decision

`ActionExecution` 是每个受限或可能有副作用动作的唯一持久真源。它以稳定 actionId 贯穿：

```text
prepared
→ executing
→ succeeded | failed | unknown

prepared
→ not_executed
```

确定终态可以投影为 ActionReceipt，但不建立第二张 Receipt 表或第二套状态。

动作必须先规范化并冻结参数、Kind、Digest、来源 AgentRun 与控制模式：

- `mediated`：Core 自己执行，能够保证 persist-before-dispatch。
- `intercepted`：Runtime 在执行前请求 Lumen，能通过协议门禁。
- `observed`：Runtime 已执行后才通知，只能审计/对账，不能宣称先审批或 exactly-once。

封闭、版本化的 Action Kind 注册表决定哪些动作必须记录以及如何规范化。Shell、写文件、Git 变更、外部写 API、敏感读取和语义未知工具默认进入 ActionExecution。

## Approval

Approval 只授权一个 `ActionExecution(prepared)` 的规范化动作。身份至少绑定：

```text
actionId
actionKind
actionDigest
target user
```

只有目标用户可以解决 Approval。`approved` 只表示授权，不表示动作已经派发或成功；拒绝、取消、过期等结果使 ActionExecution 进入相应 `not_executed` 原因。

## Dispatch and reconciliation

- 每个派发 Attempt 具有独立序号/身份和 dispatch marker，旧 Attempt 结果不能覆盖新事实。
- 在跨系统原子边界无法证明是否派发时，保守进入 `unknown`，不能把超时写成 failed。
- 自动重试只允许在证明未发生或外部目标按稳定幂等键安全重放时进行。
- 人工放弃对账保留 unknown 真相，并永久禁止同一 Action ID 重放。
- 返回 Runtime 的授权/结果使用窄化 Delivery Checkpoint，绑定 payload Digest、目标 epoch 和 Native Request；ACK 只证明对应载荷被接收。
- `authorization_resolution(allow)` 在 ACK 丢失且协议幂等性未经证明时不能盲目重发。

## Workspace and Git

AgentRun 在 Native Runtime 绑定前保存 Workspace：`executionRoot / read_only|write / shared|git_worktree / repositoryScopeId / baseGitCommit`。绑定后不可静默修改。

v0.02 不实现 Workspace 写锁；Runtime 并行不代表文件写入隔离。Worktree 由 Agent/User 通过显式 Git 动作选择、创建、合入和清理，Core 只做路径、权限、Repository Scope 和 Git 对象校验。

## Schema and recovery

- 新增 `action_execution`、`action_attempt`、`approval` v0.02 字段和 Runtime Delivery Checkpoint。
- legacy Approval 迁移时保留原请求/决定；无法构造完整动作参数的记录只能成为不可执行的历史/observed 事实，不能自动重放。
- Executor、Reconciler、Delivery Worker 和 Cancellation Finalizer 只扫描各自权威状态并使用租约/fencing 认领。
- 应用恢复顺序先对账 unknown 和未终结 Delivery，再允许 AgentRun 恢复。

## Acceptance

- 在 persist、dispatch、result、Approval resolve 和 Runtime ACK 每个边界模拟崩溃，最终状态均可解释。
- 已成功或 unknown 的动作不会因应用重启重复执行。
- 两个并行动作/Approval 不串 actionId、Digest 或 Runtime Request。
- 旧 epoch、旧 Attempt 和重复回调不能覆盖当前结果。
- Approval 通过后执行失败，UI 明确同时显示“已授权”和“执行失败”。
- Git Commit 证据在 Task 完成前已按 Repository Scope 固定并保持可达。

## Consequences

- 授权、派发、外部发生事实、执行结果和 Runtime Delivery 必须分别建模；UI 与审计不能再用 Approval 状态推断动作结果。
- 无法证明外部动作是否发生时必须保留 `unknown`，这限制了自动重试，并要求显式 Reconciler 或人工收敛路径。
- 所有可识别副作用都需要稳定 Action ID、规范化参数、Attempt fencing 和恢复顺序，增加了持久化与 Worker 协调成本。
- Workspace 与 Git 隔离保持显式和可审计，但 v0.02 不承诺自动 Worktree 管理或并发写隔离。

## Rejected Alternatives

- Approval 兼任执行结果。
- PreparedAction 与 ActionReceipt 两套权威表。
- 通用 Outbox 驱动动作。
- 将超时、连接断开或 ACK 丢失直接解释为未执行。
- 自动 Worktree Manager、自动合入和 Workspace 写锁。

## References

- [ADR-0001: Core Transaction](0001-core-transaction.md)
- [ADR-0003: Execution Runtime](0003-execution-runtime.md)
- [v0.02 核心组件与实施包](../versions/v0.02/core-components.md)
- [v0.02 实施与验收清单](../versions/v0.02/implementation-and-acceptance.md)
