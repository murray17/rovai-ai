---
document_type: interface-contract
contract: tool-interaction-measurement
version: 1
authority: qualification-tool-opportunity-trace-and-tool-use-judge
status: accepted
last_updated: 2026-08-13
---

# Tool Interaction Measurement v1

本合同冻结 Qualification 中 opportunity-based Tool trace、确定性 assessment 和独立 Tool-Use Judge 的边界。
它是 advisory Measurement Layer，不改变 Layer 1 Hard Outcome，也不替代 Tool Call Ledger 或 Process Judge。

## Measurement Spec 与 Opportunity

`rovai.qualification.tool-measurement-spec@1.0.0` 在 dispatch 前绑定 Case ID/Seal、partition
`development | holdout`、private Fixture/Oracle digests、projection policy 和非空 opportunities。每个 opportunity
的闭合字段为：

```json
{
  "opportunityId": "OP-...",
  "adapter": "camp_history | memory_retrieval | memory_mutation | camp_message_send",
  "mode": "forced_use | natural_use | non_use_control",
  "allowedOperations": ["camp.read"],
  "semanticItems": ["SER.tool_use.selection_necessity"]
}
```

Fixture symbols 位于 private Fixture，逐 Opportunity oracle 位于独立 private Oracle；admission 以 spec/fixture/oracle
三个 digest 绑定它们。Runner materialize 后才把 symbol 解析为该 arm 的 fresh entity/revision identity，resolved oracle
只进入 current-user-only replay source，不进入 Measurement、Judge Pack 或结果摘要。

Opportunity ID 是 measurement denominator。`forced_use` 表示 disclosed requirement 直接要求该能力；
`natural_use` 表示任务可在不泄漏答案时创造明确 retrieval/retention 机会；`non_use_control` 表示不调用是预期行为。
 observed Call 不得新增 Opportunity、改变 class 或事后扩大 allowed Tool set。

Private Fixture 使用 symbolic identity。Materializer 为每个 arm 创建 fresh Camp/CampMessage/Memory/Revision，再生成
immutable Prepared Tool Fixture Manifest，绑定 symbol、fresh entity ID、content/revision digest 和 Case/arm。Fixture body、
retrieval key 和 sealed oracle 不进入 public report或 Model-Visible Pack。

## Canonical Operation Evidence

Core `runtime.action` 可增加 closed `operationProjection`；其内部包含 `schemaVersion`、`operation`、
`canonicalInput`、`canonicalResult`、`digestBinding`、`inputDigest`、`resultDigest` 与 `projectionDigest`。只允许 operation
adapter 的 closed projection；未知字段 fail closed。所有 string/cardinality 有界，禁止 credential/token、authorization header、raw Tool
transcript、unbounded body/snippet、filesystem locator 和 provider-private metadata。

Current Built-in 的调用边界必须由 Core 在执行操作前 durable 写入 `started` Evidence，且该 start record 已绑定
authenticated AgentRun、scoped Tool Call identity、canonical input 与 `rawInputDigest`；start admission 失败则不得执行操作。
terminal record 再绑定 canonical result、`rawOutputDigest`、receipt/replay 与 lifecycle。Qualification 只有在 Execution
Evidence 分页完整、且每个 observed Core Built-in interaction 都存在 start fence 时，才可把该 operation family 的调用
观测边界标为 complete；仅有 terminal evidence 的旧 Trial 保持 partial。因此 `non_use_control` 的 no-call 结论不依赖
事后缺失猜测，start 与 terminal 也不得计成两次调用或两个效果。

- Camp History：mode/query/limit/cursor/target IDs；result Message IDs、sequence/cursor/cache/truncation；
- Memory Retrieval：query/limit/Memory IDs；result Memory/Revision IDs、cache state、pagination/truncation；
- Memory Mutation：scope/kind、secret-filtered 且逐项/总数有界的 semantic body/retrieval keys、base revision/target ID；
  result Memory/Revision/version/lifecycle；bounded semantic fields 是 retention/input strategy 的必要证据，不是 raw payload；
- A2A Send：recipient/task/reply identities 与 mention mode；result Message/Delivery/Run/receipt identities。

`digestBinding` 必须声明 input projection 绑定 `rawInputDigest`、result projection 绑定 `rawOutputDigest`。它证明投影源自
同一 Core operation envelope，不宣称投影可反向重建 raw payload。Evidence 保持 Agent-inaccessible。

## Tool Interaction Measurement artifact

`buildToolInteractionMeasurement` 生成 `rovai.qualification.tool-interaction-measurement@1.0.0`。Payload 包含 source
references、opportunities、canonical interactions、逐 opportunity deterministic assessment 与 coverage；禁止
`score`、`aggregateScore`、`winner`、隐式正向 call count 或 post-hoc opportunity。

Operation Adapter 至少保留：

- trace identity、AgentRun、canonical tool、authority、lifecycle、authorization、receipt/replay；
- bounded canonical input/result 与各自 evidence reference；
- opportunity match state `matched | missing | unexpected | ambiguous`；
- oracle alignment 的 typed findings；
- `complete | partial | unavailable | not_applicable` coverage 和 stable reason codes。

Deterministic assessment 判断调用/receipt/effect 是否存在、字段/身份/digest 是否闭合、result IDs/revisions/cursor 是否
满足 sealed oracle。它不得判断查询是否聪明、信息是否被理解、贡献是否有意义。

## Tool-Use Judge Pack

`buildToolUseJudgePack` 从 Measurement artifact 构造 treatment-blind Model-Visible Pack，checklist 闭集为：

1. `SER.tool_use.selection_necessity`
2. `SER.tool_use.input_strategy`
3. `SER.tool_use.result_interpretation`
4. `SER.tool_use.downstream_use`
5. `SER.memory.retention_quality`

每个 opportunity 只启用预注册 applicable items。Pack 允许 disclosed requirements、operation family、bounded canonical
input/result、随后 public message/code/check candidate evidence、coverage 和 local `EV-xxxx`；禁止 sealed oracle、fixture
relevance labels、deterministic alignment verdict、Team/Solo/treatment、真实 Agent/model identity、Hard Outcome 和真实
Evidence Reference。A2A 的语义 items 始终留给 Process Judge，Tool-Use Pack 只显示其 deterministic send integrity。

LLM 判断：是否应调用或应避免调用、query/input 策略是否切中任务、observed result 是否被正确解释、后续交付是否吸收
结果、Memory mutation 是否值得长期保留且 scope/retrieval strategy 合理。LLM 不判断执行成功、计时、receipt、ID/revision
相等或 oracle 命中。

Tool-Use Review 使用与 Semantic Judge Views v1 相同的 version-identifiable snapshot、tools/network/workspace none、双
Replica reverse order、exact item closure、typed abstention、no selective retry、categorical disagreement 和 immutable
retention 不变量，但有独立 configuration/pack/replica/review schema，不加入 `process | outcome` View 闭集。
`result_interpretation` 没有 digest-bound exact retrieved content、或 `downstream_use` 没有候选后续交付内容时，coverage
必须为 unavailable 并迫使 Replica abstain；只给 Message/Memory ID 不允许模型猜测语义。若后续 code/final response
只有同 Trial candidate relation 而没有 authoritative causal lineage，则 `downstream_use` 只能是 partial，LLM 不得把它判为
`satisfied`；候选内容相似不能冒充“Tool 结果已被吸收”的因果证明。

## Coverage 与评分边界

- complete source 证明无 observed Tool interaction 时，`non_use_control` 可 deterministic 满足 no-call；其他 class 为
  missing，而不是 LLM `not_satisfied`；
- source coverage 不完整时不得把无 call 推断为未调用，assessment/Judge item 为 unavailable/indeterminate；
- call count、returned item count 和 member count 只作无方向事实；
- 逐项 categorical/typed deterministic findings 均可报告，但不得形成 Tool/collaboration aggregate score；
- paired Tool availability ablation、Team/Solo uplift 与统计 claim 由 Paired Collaboration Experiment 合同拥有。

## References

- [ADR-0171](../versions/v0.68/decisions.md#adr-0171)
- [Paired Collaboration Experiment v1](paired-collaboration-experiment-v1.md)
- [Semantic Judge Views v1](semantic-judge-views-v1.md)
- [Benchmark Protocol 架构](../architecture/benchmark-protocol.md)
