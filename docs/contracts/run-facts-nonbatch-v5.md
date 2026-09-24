---
document_type: protocol-contract
contract: run-facts-nonbatch-v5
authority: nonbatch-dynamic-run-facts
status: accepted
version: 5
last_updated: 2026-09-23
---

# Run Facts 非 batch v5

普通 Camp、A2A 与 Single Chat 的新模型投影从 [v4](run-facts-v4.md) 删除顶层
`schemaVersion`，保留业务 shape：

```ts
type NonbatchRunFacts = {
  attachmentOutputRoot: string
  mission?: { missionId: string; title: string; status: 'needs_you' | 'not_started' | 'in_progress' | 'completed'; updateNotice?: string }
  conversationMode?: ConversationModeFact
  taskContext?: TaskContextFact
  sessionContinuity?: SessionContinuityFact
  externalEffect?: ExternalEffectFact
  gather?: GatherFact
  delegation?: DelegationFact
}
```

Single Chat 的 `conversationMode` 必有且不接收 Mission facts；其他可选字段及省略规则继承 v4。
内部 `run_facts_schema_version` 为 5，只在 ContextManifest 机器证据中记录，不进入模型正文。
