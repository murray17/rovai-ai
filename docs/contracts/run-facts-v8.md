---
document_type: protocol-contract
contract: run-facts-v8
authority: public-camp-dynamic-run-facts
status: accepted
version: 8
last_updated: 2026-09-25
---

# Run Facts v8

新公开 batch Camp Run 的 `RUN_FACTS` 顶层业务 shape、必选与可选字段保持 [v7](run-facts-v7.md) 不变。内部合同号 8 只写入 ContextManifest，不向模型暴露。

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

`attachmentOutputRoot` 和 `historyHint` 每次必有，其余事实、值域及省略规则沿用 v7。模型正文不含 `schemaVersion`、`conversationMode`、`gather`、`delegation` 或额外消息判断结果、数量、ID、另一份边界。非 batch（含 Single Chat）仍使用 [Run Facts 非 batch v5](run-facts-nonbatch-v5.md)，不含 `historyHint`。

本版 `historyHint` **只允许**以下四种完整英文值（`P` 为本 Agent 在当前 Camp 上一次有效 Runtime accepted ACK 对应 Run 执行前的公屏尾；无记录时内部为零）：

| 冻结边界 | claim 时额外可见消息 | 完整 `historyHint` 文本 |
| --- | --- | --- |
| `P > 0` | 确认不存在 | `The latest public message before your last recorded run in this Camp had sequence {P}. As of this run's start, all visible messages after that sequence are already in RUN_INPUT or were written by you.` |
| `P > 0` | 确认存在 | `The latest public message before your last recorded run in this Camp had sequence {P}. As of this run's start, there are additional visible messages after that sequence beyond RUN_INPUT and messages written by you.` |
| `P = 0` | 确认不存在 | `As of this run's start, all visible messages in this Camp are already in RUN_INPUT or were written by you.` |
| `P = 0` | 确认存在 | `As of this run's start, there are additional visible messages in this Camp beyond RUN_INPUT and messages written by you.` |

判断只在同一个 batch claim 事务中进行。`T` 是本次 claim 的公屏尾，`I` 是最终领取并进入 `RUN_INPUT.messages` 的**全部** message ID，`A` 是当前 Agent ID。`P > 0` 查询 `P < message.sequence <= T`，`P = 0` 查询 `message.sequence <= T`；首轮不能因没有边界而推断为不存在。查询沿用当前 Agent 对当前 Camp 的 `camp.read` 时间线可见性：同 Camp、非 tombstone；已撤回而仍可显示 `Message withdrawn` 的占位符是可见消息。只有 `message.id IN I` 和 `message.author_type = 'agent' AND message.author_id = A` 被排除；其他 Agent 的可见消息、本 Agent 未领取的队尾以及超过一页历史的可见消息均不得排除。不得拿 waiting Delivery 候选代替历史可见集合。查询仅为无正文、无数量、无分页上限的 `EXISTS`；正常 claim 的判断只有 true/false，查询失败须回滚 claim，不创建该 Run、不领取消息，也不生成“未知”提示。

`this run's start` 只断言 claim 时 `(P, T]` 或 `<= T` 的消息快照，不是实时状态或 `P` 以前历史已提供的保证。true 只表示额外**可见**消息存在，不要求读取或增加工作责任；`historyHint` 不是已读、已处理、工作完成水位，也不是 `camp.read --before` 游标。claim 在 Run 内部冻结 `P` 和布尔值，不保存额外消息正文、数量、列表或历史快照；构造模型文本时选择本表句子，同 Run 再次加载复用冻结 ContextManifest／payload，不根据后来消息、撤回或 accepted 水位重算。`historyHint` 完整文本同时参加 claim 的容量选择和最终 payload 字节检查，不得截断 `RUN_INPUT`。accepted 水位只按原有有效 Runtime accepted ACK 推进。

[ContextManifest Evidence v31](context-manifest-evidence-v31.md) 拥有与该字段配套的版本、Charter 和冻结证据。[已确认的独立变更说明 revision 5](../versions/v1.70/model-context-change-history-hint-additional.md)固定完整前后文本与边界；合同 accepted 不表示代码、迁移或验证已经完成。
