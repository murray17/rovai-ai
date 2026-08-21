---
document_type: contract
contract: context-delivery-profile-v4
status: accepted
target_version: v1.15
last_updated: 2026-08-20
---

# Context Delivery Profile v4

Profile v4 是当前 AgentRun Dynamic Context 的 selection、ordering、limit 与 budget-priority 合同。它继承
[Profile v3](context-delivery-profile-v3.md) 的 self-active Task、public reference closure、Unicode scalar
预算与 Runtime payload priority，只改变 `SHARED_CONVERSATION.recentMessages` 的作者候选资格及与该资格
对应的 whole-history omission。

```json
{
  "profileVersion": 4,
  "maxPublicMessages": 15,
  "maxPublicHistoryChars": 24000,
  "maxMessageBodyChars": 2000,
  "maxPublicReferenceChainMessages": 3,
  "maxSelfActiveTasks": 8
}
```

按 canonical key order 序列化后的 SHA-256 digest 固定为：

```text
022688d6f133ea3bb6e6d5773cd30aec1db7a184e4419bbc0fe9c554518bc8d9
```

## Recent public candidate

Core 对 `(previousAcceptedPublicBoundary, currentBoundary]` 内当前 Camp 的已发布消息执行以下顺序：

1. 排除 tombstone；
2. 排除当前 trigger CampMessage；
3. 排除 `author_type = 'agent' AND author_id = currentAgentId`；
4. 对剩余 eligible candidate 执行 `sequence DESC, LIMIT 15`；
5. 反转为 `sequence ASC`，再执行 Agent body projection、reference 去重和预算 gate。

`currentAgentId` 必须来自被冻结 AgentRun/recipient Conversation 的 `agent_id`，不能从正文、Renderer、Runtime
或 message `source_agent_run_id` 推断。用户、其他 Agent 和 system 消息继续 eligible。自身消息不占 top-15，
因此更新的自身消息不能挤出更早的 eligible 消息。新建、替换或不兼容 Native Session 从 boundary `0`
重选时应用同一谓词。

## Omission、reference 与 boundary

Whole-history `omittedMessages` aggregate 使用与 recent selector 相同的自身作者排除谓词。仅因自身作者过滤而
未进入 recent 的消息不计入 omission count/range，也不创建 `max_public_messages`、`history_budget` 或
`runtime_payload_budget` omission entry。

该规则不是全局隐藏：

- 当前 trigger 仍只通过完整 `CURRENT_INPUT` 投递；
- `originatingPublicUserMessage` 的 user lineage 不变；
- 自身消息若是理解 eligible message 所需的祖先，仍可进入独立 `referenceClosure`，并保留现有 reference
  budget omission evidence；
- Camp timeline、History/Search、Renderer、持久 CampMessage、reply、mention 与附件均不变。

Runtime accepted ACK 仍把 public boundary 推进到本次完整 `currentBoundary`，包括被 recent filter 跨过的自身
message sequence。未 accepted 的输入不推进 boundary；恢复或重选时仍重新应用相同过滤。

## Self-active Task 与预算

Self-active candidates 继续严格来自目标 Agent 在当前 Camp 显式负责的 `pending`、`in_progress`、`blocked`
Task，按 `updatedAt DESC, taskId DESC` 选择最多八项。公共历史先为 Runtime payload budget 让位，随后从 Task
selection tail 移除；Task omission 仍只提供 aggregate `omittedCount`。

Profile 不拥有 Formatter section/JSON shape 或 Manifest evidence columns。当前 owner 分别是 AgentRun Context
Formatter 20 与 [ContextManifest Evidence v19](context-manifest-evidence-v19.md)。Direct materialization 与 A2A
preflight 必须共用同一个 recent selector、omission predicate 和 Profile v4 resolved value。

## References

- [v1.15 已确认模型上下文变更](../versions/v1.15/model-context-change-self-authored-recent-messages.md)
- [Context Delivery Profile v3](context-delivery-profile-v3.md)
- [ContextManifest Evidence v19](context-manifest-evidence-v19.md)

