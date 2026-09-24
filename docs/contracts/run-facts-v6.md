---
document_type: protocol-contract
contract: run-facts-v6
authority: public-camp-dynamic-run-facts
status: accepted
version: 6
last_updated: 2026-09-23
---

# Run Facts v6

公开 Camp 的新模型投影从 [v5](run-facts-v5.md) 删除顶层 `schemaVersion`，保留完整业务 shape：

```ts
type PublicRunFacts = {
  attachmentOutputRoot: string
  mission?: { missionId: string; title: string; status: 'needs_you' | 'not_started' | 'in_progress' | 'completed'; updateNotice?: string }
  taskContext?: TaskContextFact
  sessionContinuity?: SessionContinuityFact
  externalEffect?: ExternalEffectFact
}
```

Mission notice 的固定内容及省略规则继承 v5。内部 `run_facts_schema_version` 为 6，仅存在于
ContextManifest 机器证据。公开 Camp 仍不生成 `conversationMode/gather/delegation`。

非 batch（包括 Single Chat）新投影见 [Run Facts 非 batch v5](run-facts-nonbatch-v5.md)。
