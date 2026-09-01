---
document_type: protocol-contract
contract: accepted-input-recovery-v5
authority: accepted-runtime-input-recovery-and-cancellation-separation
status: accepted
version: 5
source_version: v1.37
last_updated: 2026-09-01
---

# Accepted Input Recovery v5

继承 [v4](accepted-input-recovery-v4.md) 的 `dispatch_started_at`、发送准入、迟到观察、冻结模型字节、普通启动恢复
分类和禁止 accepted input 自动重发。本版将普通恢复结果与业务取消终态明确分开。

普通启动恢复中的 `waiting/recovery_blocked` 仍只能由用户显式结束为
`failed / accepted_input_outcome_unknown`；accepted Input、执行现场和外部效果证据继续保留。该动作不属于取消，
不能确认成功或重发旧输入。

用户 Stop、CampTurn Stop、预算中止、成员离队、强制删除、应用退出和旧半取消补偿统一采用
[Cancellation Settlement v2](cancellation-settlement-v2.md)：Run 终态为 `cancelled`，Input 仍按发送证据保留为
`accepted`、`delivery_unknown` 或 `not_accepted`。取消不会把 accepted 证据改成未发送，也不会创建自动 retry、
successor 或新的模型输入。
