---
document_type: protocol-contract
contract: cancellation-settlement-v2
authority: camp-cancellation-business-terminal-and-runtime-cleanup
status: accepted
version: 2
source_version: v1.37
last_updated: 2026-09-01
---

# Cancellation Settlement v2

继承 [v1](cancellation-settlement-v1.md) 的事务线性化、定向 membership cutover、Delivery/Gather 收口、
terminal delivery pump、三秒 Runtime 清理、Conversation cleanup fence、渠道边界和目标 Camp 补偿。
本版只修正取消终态与效果证据之间的关系。

## 取消终态

任何由取消事务命中的非终态 AgentRun 都结算为 `cancelled`，不再根据 Runtime Input、Action 或 Runtime
Delivery 的发送/执行证据改写为 `failed / accepted_input_outcome_unknown`。事务同时清除 wait、recovery、lease、
公开 Runtime failure 和旧错误字段，保持 `manual_retry_allowed = false`，并记录 `agent_run.cancelled`。

Input 与效果证据仍按原规则关闭或保留：未开始 dispatch 的 prepared Input 为 `not_accepted`；已经取得发送准入的
prepared Input 为 `delivery_unknown`；accepted/delivery_unknown Input 不降级；可能派发的 Action 继续保留 unknown
证据。`cancelled` 不表示输入未发送、外部效果已回滚或 Runtime 进程已经退出，也不允许自动重发原输入。

`accepted_input_outcome_unknown` 继续属于普通启动恢复中的显式 Recovery Blocker resolution，以及其他并非取消事务
拥有的 continuity-loss 路径。它不再作为用户 Run Stop、CampTurn Stop、预算中止、成员离队、Camp 强制删除、
旧半取消补偿或应用退出的取消终态。

## 投影与历史兼容

取消事务保留的 Input/Action 证据是审计事实，不产生 `hasUnsettledExternalEffects` 用户注意提示，也不污染后续
Composer、CampTurn 或 ChannelTurnRequest。Renderer 收到 Applied 后立即显示已取消并清除本地旧提示。

为修正 v1 已写入的历史行，Read Side 对以下精确形状做兼容投影：

```text
status = failed
last_error_code = accepted_input_outcome_unknown
cancel_requested_at IS NOT NULL
terminal_resolution_source IS NULL
```

该形状公开为 `cancelled` 且 `hasUnsettledExternalEffects = false`。SQLite 历史行、Input/Action evidence、事件与
cleanup ACK 不改写；普通 Recovery Blocker resolution 和 Runtime terminal 结果不命中该兼容规则。

## 后续执行与清理

业务终态提交后仍对 Run-local、成员 cutover 和旧半取消的精确 Run 集合调用既有 terminal delivery pump；整轮取消
仍先关闭该 Turn 的 pending Delivery，因此不调用 pump。Runtime cleanup 继续在 scheduler 外后台执行并按
`ActiveExecutionKey` 去重；同 Conversation 只有 `cancel_acknowledged_at` 能解除旧执行隔离，其他 Conversation、
同轮无关 Run 与已 admitted 渠道请求不等待该清理。
