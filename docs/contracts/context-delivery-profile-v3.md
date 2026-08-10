---
document_type: contract
contract: context-delivery-profile-v3
status: accepted
target_version: v0.54
last_updated: 2026-08-10
---

# Context Delivery Profile v3

Profile v3 是当前 AgentRun Dynamic Context 的 selection、ordering、limit 与 budget-priority 合同。它在
v2 公共历史与 reference closure 规则上增加 self-active Task candidate selection；v1/v2 不作为当前
reader。

```json
{
  "profileVersion": 3,
  "maxPublicMessages": 15,
  "maxPublicHistoryChars": 24000,
  "maxMessageBodyChars": 2000,
  "maxPublicReferenceChainMessages": 3,
  "maxSelfActiveTasks": 8
}
```

Self-active candidates 严格来自目标 Agent 在当前 Camp 显式负责的 `pending`、`in_progress`、`blocked`
Task。Lead 与非 Lead 相同；不选 unassigned、terminal、creator-only 或其他成员 Task。排序固定为
`updatedAt DESC, taskId DESC`，选择前八项；`updatedAt` 只用于选择和 Evidence，不进入模型字段。

Runtime payload 超预算时，先按既有顺序移除 optional public history；随后从 Task selection tail
逐项移除。所有因八项上限或 payload budget 排除的 candidate 都进入一个 aggregate
`omittedCount`，不暴露其 ID。若没有 Task 项能保留，则整个 section 省略而不是单独导致 Run 失败；
Current Input 等必要内容仍可独立触发 payload-too-large。

Profile 不拥有 section 名、模型 JSON 字段或 Manifest evidence shape；它们分别由 Formatter v13 与
ContextManifest v11 拥有。Profile 也不建立 Task watermark、delta 或 ACK。真实 candidate 空集合的
显式 snapshot 与候选被预算全部排除后的 whole-section omission 区分见 ADR-0153；该区分不改变本
Profile 的 candidate selection 或 budget priority。
