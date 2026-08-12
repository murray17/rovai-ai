---
document_type: adr
id: ADR-0164
title: Accepted Input Recovery Requires Proven Native Turn Reconciliation
status: accepted
date: 2026-08-12
decision_scope: cross-version
source_version: v0.64
supersedes: []
intended_supersedes: []
superseded_by: null
---

# ADR-0164: Accepted Input Recovery Requires Proven Native Turn Reconciliation

## Context

Rovai 会持久化 Runtime Input Delivery 的 `accepted` 回执，并在 Core 重启后禁止同一输入被普通
Scheduler 再次发送。这条安全 fence 能避免重复模型调用和外部副作用，但旧恢复路径把 Run 长期留在
`waiting/runtime_recovery`，还把 Native Session 的 `load/resume` 当成旧 Native Turn 已重新附着。

这两个事实并不等价。Session 可以跨进程重新加载，不代表新 Host 可以重新取得旧 prompt 的稳定身份、
运行状态和 terminal result。当前 ACP `active_prompt`、pending JSON-RPC route 和
`acp-prompt-*` correlation 都属于 Rovai Host 本地状态，不能证明 Provider 提供了跨进程 Turn identity。

## Decision

1. Native Session Resume 与 Native Turn Reconciliation 是两个独立能力。任何 Session-level
   capability、Session ID、Compatibility Key、Installation generation 或成功 `session/load` 都不得
   推导旧 Turn 可重新附着。
2. 已存在 `accepted` Runtime Input Delivery 的非终态 Run 不得自动重发原输入、创建新 execution
   epoch、提升为 prepared/delivery-unknown，或仅凭 Session resume 声明已恢复。
3. Core 只有在 Adapter 显式声明并通过实测的 `native_turn.reconcile.v1` capability 后，才能进入自动
   Native Turn 对账。该能力必须提供 Provider 生成的跨进程稳定 Turn ID、无新模型调用的 lookup/reattach、
   `running | completed | failed | not_found | ambiguous` 区分、terminal result 重读与幂等 reconcile。
4. 在没有该能力时，启动恢复把满足条件的 Run 收敛为 `waiting/recovery_blocked`，清除
   `runtime_recovery_required`，并记录 `accepted_input_outcome_unknown`。该状态不进入普通 Scheduler，
   也不触发无意义的 Session resume 循环。
5. 用户可以显式把 blocker 结束为 `failed/accepted_input_outcome_unknown`。这不是成功确认、原输入 retry
   或 successor 创建；accepted Delivery、Execution Evidence、Git/Workspace 现场与外部效果证据继续保留。
   后续工作必须由用户在检查现场后创建新的 Run 和新的输入。
6. CampTurn Stop 或 Execution Budget 到期同样不得把该歧义抹成普通 cancelled；Run 必须以
   `accepted_input_outcome_unknown` 失败收敛，且原输入仍不得重发。

本 ADR 局部细化 ADR-0062、ADR-0067、ADR-0077、ADR-0079 与 ADR-0138 的恢复、取消和 accepted-input
边界；它不替代这些 ADR 的其他条款。

## Consequences

- Core 重启后的 accepted input 不再永久显示正在自动恢复，也不会因移除 Scheduler 过滤而重复执行；
- 结果未知被建模成持久、可操作的 blocker，用户能够检查现场并明确结束；
- 自动恢复 Session 仍可用于尚未 accepted 的安全输入，但不能被包装成旧 Turn 恢复；
- 真正的 Turn reattach 需要逐 Adapter、逐版本实验和新 capability，P0 不承诺 exactly-once reattach；
- Runtime、Read Side、Renderer、预算和取消路径必须共享相同的 outcome-unknown 终态语义。

## Rejected Alternatives

- **移除 accepted-input Scheduler 过滤并重发**：会重复模型调用、工具执行、文件修改或外部副作用。
- **成功 `session/load` 后继续等待旧 response**：旧 JSON-RPC route 已随 Host 消失，只会制造另一种假恢复。
- **把 Rovai correlation ID 当作 Native Turn ID**：`acp-prompt-*` 不是 Provider 的跨进程稳定身份。
- **到期或 Stop 后记录普通 cancelled**：会丢失“Runtime 已接受、最终结果未知”这一关键审计事实。
- **直接把 blocker 确认为 succeeded**：没有 terminal result，不能伪造成功或最终输出。

## References

- [v0.64 版本目标](../versions/v0.64/README.md)
- [ADR-0062：Interruptible Runs](0062-interruptible-runs-and-unsettled-external-effects.md)
- [ADR-0067：Native Session Bootstrap 与 AgentRun Context](0067-native-session-bootstrap-and-agentrun-context-v3.md)
- [ADR-0138：Durable Bootstrap Redelivery Requirement](0138-durable-bootstrap-redelivery-requirement.md)
- [Accepted Input Recovery v1](../contracts/accepted-input-recovery-v1.md)
- [AgentRun Recovery 架构](../architecture/agent-run-recovery.md)
- [Copilot Native Turn P1 实验与负向证据](../versions/v0.64/copilot-native-turn-reconciliation-experiment.md)
