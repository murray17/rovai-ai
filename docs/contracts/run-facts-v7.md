---
document_type: protocol-contract
contract: run-facts-v7
authority: public-camp-dynamic-run-facts
status: accepted
version: 7
last_updated: 2026-09-23
---

# Run Facts v7

新公开 Camp Run 的 `RUN_FACTS` 使用下列完整顶层业务 shape。内部合同号 7 只写入 ContextManifest，不向模型暴露。

```ts
type PublicRunFacts = {
  attachmentOutputRoot: string
  historyHint: string
  mission?: { missionId: string; title: string; status: 'needs_you' | 'not_started' | 'in_progress' | 'completed'; updateNotice?: string }
  taskContext?: TaskContextFact
  sessionContinuity?: SessionContinuityFact
  externalEffect?: ExternalEffectFact
}
```

`attachmentOutputRoot` 和 `historyHint` 每次必有。其余事实、值域和省略规则继承 [v6](run-facts-v6.md)。不输出 `schemaVersion`、`conversationMode`、`gather` 或 `delegation`。非 batch（含 Single Chat）仍使用 [Run Facts 非 batch v5](run-facts-nonbatch-v5.md)，不含 `historyHint`。

`historyHint` 只允许下面两种完整英文值：

```text
The latest public message before your last recorded run in this Camp had sequence {N}.
No public-message boundary from a previous run is recorded for you in this Camp.
```

`N` 是当前 `(CampId, AgentId)` 上一次有效 accepted ACK 对应 Run **执行前**冻结的公屏尾 sequence。未记录有效边界时使用第二句；内部零值不作为消息序号输出。提示不是已读、已处理或工作完成水位，不是 `camp.read --before` 游标。Core 在新 Run 构造时冻结这句话；同一 Run 恢复复用原始 facts 与 payload。有效 accepted ACK 后即使 Run 被停止，边界也不回退；无效、迟到或非 accepted ACK 不推进。

[独立变更说明 revision 1](../versions/v1.68/model-context-change-public-history-hint.md)记录了完整前后结构与二次确认。
