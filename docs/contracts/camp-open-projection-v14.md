---
document_type: protocol-contract
contract: camp-open-projection-v14
authority: camp-open-cancellation-compatibility-projection
status: accepted
version: 14
source_version: v1.37
last_updated: 2026-09-01
---

# Camp Open Projection v14

继承 [v13](camp-open-projection-v13.md) 的 wire、collection、图片、渠道来源、目标 Camp 半取消修复和历史读取规则。
Open schema 6、Snapshot 34、Navigation 3 不变，ReadModel 与嵌套 loader 仍不读取 event_log。

新取消事务直接投影 `cancelled` 且不设置 `hasUnsettledExternalEffects`。对 v13 期间写入的
`failed / accepted_input_outcome_unknown` 行，只有同时存在 `cancel_requested_at` 且没有
`terminal_resolution_source` 时，AgentRun public view 兼容投影为 `cancelled` 和
`hasUnsettledExternalEffects = false`。该读取规则不更新 SQLite，不丢弃 Input/Action evidence，也不影响普通
Recovery Blocker resolution 或 Runtime terminal 结果。

有界 Camp Open 排序不再把上述历史取消行当作结果未知 blocker 优先加载；其余窗口和 high-water 规则不变。

## Public A2A 投递来源

完整继承 [v13 的来源语义](camp-open-projection-v13.md#public-a2a-投递来源)：`sourceAgentRunId` 来自 Delivery
业务行，不能从目标 Run、reply 或 event history 推断。取消补偿与历史兼容投影都不改变该读取边界。
