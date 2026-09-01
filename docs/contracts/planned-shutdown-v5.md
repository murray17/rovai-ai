---
document_type: protocol-contract
contract: planned-shutdown-v5
authority: planned-shutdown-cancelled-business-settlement-and-runtime-cleanup
status: accepted
version: 5
source_version: v1.37
last_updated: 2026-09-01
---

# Planned Shutdown v5

继承 [v4](planned-shutdown-v4.md) 的 wire `protocolVersion = 3`、十秒 hard deadline、durable cycle、两阶段
business pass、writer/route barrier、Runtime reap 和完整 report shape。本版只采用
[Cancellation Settlement v2](cancellation-settlement-v2.md) 的终态分类。

退出事务命中的所有非终态 Run 都成为 `cancelled`，无论 Input 已 accepted、prepared 已取得 dispatch 准入，
还是 Action 可能已派发。底层 Input/Action evidence 保留，原输入不得重发；公开 Run 不显示“外部效果待确认”。
不设置 CampTurn cancel intent 的既有聚合不变，因此 required Run cancelled 仍可使 Turn
`failed / required_run_incomplete`。

`unsettledEffectAgentRuns` 报告字段继续统计取消前已经存在的 Input/Action/Runtime Delivery 不确定证据，不能再从
AgentRun `last_error_code` 推断。该内部退出计数不改变公开 Run 终态或 Renderer 提示。Runtime terminal admission
产生的独立可靠终态、普通 Recovery Blocker resolution、cycle 幂等、累计计数与 cleanup ACK 边界保持不变。
