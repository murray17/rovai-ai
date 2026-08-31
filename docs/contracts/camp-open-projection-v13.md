---
document_type: protocol-contract
contract: camp-open-projection-v13
authority: camp-open-targeted-cancellation-settlement
status: accepted
version: 13
source_version: v1.37
last_updated: 2026-09-01
---

# Camp Open Projection v13

继承 [v12](camp-open-projection-v12.md) 的所有 wire、collection、图片、渠道来源和历史读取规则。
Open schema 6、Snapshot 34、Navigation 3 不变，投影及嵌套 loader 仍禁止读取 event_log。

`camps.enter` 和 `camps.open` 生成投影前，仅针对目标 Camp 检查旧取消 intent；命中尚未收口的 Run/Turn/Delivery/
ChannelTurnRequest 才在短事务内调用统一结算。没有命中时不写数据，不修复普通 waiting/recovery 或其他 Camp。
该补偿属于 service 入口，ReadModel 本身仍只读，读取返回修复之后的权威终态。

新 membership reconciliation 已在 cutover 提交内 completed，因此通常不出现旧 reconciling 活动条；字段兼容保留。

## Public A2A 投递来源

完整继承 [v12 的来源语义](camp-open-projection-v12.md#public-a2a-投递来源)：sourceAgentRunId 来自 Delivery 业务行，
不能从目标 Run、reply 或 event history 推断。取消补偿不改变这条读取边界。
