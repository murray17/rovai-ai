---
document_type: interface-contract
contract: semantic-judge-views
version: 1
authority: semantic-judge-model-visible-evidence-and-reconciliation
status: accepted
last_updated: 2026-08-11
---

# Semantic Judge Views v1

本合同冻结 Process Judge 与 Blinded Outcome Judge 的模型可见 evidence、调用接口、逐项输出和 Suite
non-interference 边界。它组合 Benchmark Protocol v3 的 Layer 5，不改变 Layer 1 Hard Outcome。

## View 与 checklist

`view` 是闭集 `process | outcome`。

Process checklist 固定为：

1. `SER.collaboration.delegation`
2. `SER.collaboration.handoff_clarity`
3. `SER.collaboration.contribution_value`
4. `SER.collaboration.feedback_absorption`
5. `SER.collaboration.lead_integration`

Outcome checklist 固定为：

1. `SER.requirements.understanding`
2. `SER.design.solution_fit`
3. `SER.implementation.quality`
4. `SER.testing.strategy`
5. `SER.scope.discipline`
6. `SER.response.claim_accuracy`
7. `SER.response.limitations`

同一 View 的 Replica A 使用上述顺序，Replica B 使用 exact reverse。两个 View 不共享 verdict、不投票、不平均，
也不生成 aggregate score。

## Configuration artifact

`rovai.qualification.semantic-judge-view-configuration@1.0.0` 必须冻结：

- `view`、exact checklist、system prompt digest 与 rubric digest；
- provider、version-identifiable model snapshot ID/digest、decoding parameters；
- `maximumTransportAttempts`、backoff 和 `retryValidOutput=false`；
- `tools=none, network=none, workspace=none`；
- projection policy 与 `exact_item_local_evidence_closure`；
- Outcome View 的预注册 `outcomeTreatmentCanaries` contamination gate；
- two-replica、reverse-order、no-voting/no-averaging/no-score reconciliation。

model alias 而没有 snapshot identity 不足以形成可比较 Configuration。

## Source Pack 与 Model-Visible Pack

现有 allowlist-built Judge Evidence Pack 是 projection source，不直接发送给 View adapter。每个 View 生成
`rovai.qualification.semantic-judge-view-pack@1.0.0`：

```json
{
  "view": "process | outcome",
  "policyId": "...",
  "configurationArtifact": { "artifactId": "...", "schemaId": "...", "schemaVersion": "1.0.0", "payloadDigest": "sha256:..." },
  "sourcePackArtifact": { "artifactId": "...", "schemaId": "...", "schemaVersion": "1.0.0", "payloadDigest": "sha256:..." },
  "modelInputDigest": "sha256:...",
  "modelInput": {},
  "evidenceMap": [
    { "localEvidenceId": "EV-0001", "evidenceReference": { "artifactId": "...", "evidenceId": "..." } }
  ]
}
```

adapter 只能收到 `modelInput`，不得收到 envelope、binding、Configuration/Source Pack reference 或
`evidenceMap`。`modelInput` 内所有引用均为 `EV-<four digits>`；输出 ID 必须能在 audit-only `evidenceMap`
中解析，且不得超出该 checklist item 的 closure。真实 Evidence Reference 仅在 reconciliation 后进入 retained
Review。

### Process allowlist

Process `modelInput` 只允许：

- public Case title、disclosed Requirements；
- `memberPseudonym + declaredRole`，不得包含真实 Agent/Member identity 或 model identity；
- normalized `interactions`：local interaction ID、sender/recipient pseudonym、visibility、local message segment、
  deterministic accepted/recipient-input/recipient-run observation；
- exact allowlisted Public A2A message content；
- 按 Message identity 去重的 content segment；fanout Delivery 只增加带稳定 ordinal 的 interaction，不复制正文；
- bounded delivered code、workspace-change facts、verification facts 与 final response；
- 每项 `complete | partial | unavailable | not_applicable` coverage 和 local Evidence closure。

`contribution_value`、`feedback_absorption` 与 `lead_integration` 的 candidate evidence 即使齐全也必须保留
`partial/semantic_relation_not_deterministically_bound`；deterministic projection 不得声明关系成立。没有 observed
interaction 时五项均为 `not_applicable`，Runner 生成 typed abstention artifacts，禁止调用 LLM。
若 source coverage 不能证明零 interaction，则空 interaction projection 必须是 `unavailable`；Runner 生成 typed
non-invoked-unavailable artifacts，禁止把缺失证据降成 `not_applicable`。

### Outcome allowlist 与 blinding

Outcome `modelInput` 只允许：

- public Case title、disclosed Requirements；
- bounded delivered code 与 path；
- normalized workspace-change facts；
- deterministic Check ID/kind/category/Requirement mapping/status；
- exact final response；
- 每项 coverage 与 local Evidence closure。

它必须按 key-level construction 排除 `team/solo/treatment/arm`、Trial/Suite/slot/Run/Call identity、Members、
roles、interactions、collaboration facts、participant messages、provider/model identity、Hard Outcome、actual Evidence
Reference、private locator 和 audit binding。相同 disclosed task 与 delivered evidence 在只改变 treatment/process/audit
metadata 时必须产生相同 `modelInput` 和 `modelInputDigest`。

结构化排除不等于能从任意自然语言中识别所有 treatment self-disclosure。Configuration 可冻结非空、预注册且
arm-specific 的 `outcomeTreatmentCanaries`；任一 canary 出现在 exact model input 中时 Pack construction 必须 fail
closed，不得改写正文或要求 Judge 忽略。未被预注册规则覆盖的自然语言泄漏属于未来 paired protocol 的
blind-eligibility limitation。

## Adapter request 与 output

每次 adapter request 的闭合 shape 为：

```json
{
  "judgeView": "process | outcome",
  "replica": "A | B",
  "presentationOrder": ["exact checklist IDs"],
  "systemPrompt": "frozen prompt",
  "userPrompt": "frozen canonical template",
  "evidencePack": { "model-visible fields only": true },
  "decodingParameters": {},
  "capabilities": { "tools": "none", "network": "none", "workspace": "none" }
}
```

adapter 返回 exact checklist item array。每项必须包含：

```json
{
  "checklistItem": "SER...",
  "dimension": "...",
  "verdict": "satisfied | partially_satisfied | not_satisfied | indeterminate | not_applicable",
  "confidence": "low | medium | high",
  "evidenceIds": ["EV-0001"],
  "reason": "bounded text",
  "abstainReason": null
}
```

`indeterminate | not_applicable` 要求 typed `abstainReason`；其他 verdict 要求 `abstainReason=null` 和至少一个
item-local Evidence ID。Pack coverage 为 `unavailable` 时只能返回 `indeterminate`；`not_applicable` 时只能返回
`not_applicable`。invalid output 不选择性重试；transport failure/timeout 只按冻结 schedule 有界重试。

## Reconciliation 与 Suite

同项 categorical verdict 相同为 `agreed`，否则为 `disagreed` 且 reconciled verdict 为 `null`；confidence 差异
只保留诊断。任一 required Replica unavailable 使该 View unavailable；不选择“更好”答案。

`rovai.qualification.semantic-judge-view-suite@1.0.0` 必须按
[`schemas/semantic-judge-view-suite-v1.schema.json`](schemas/semantic-judge-view-suite-v1.schema.json) 保留
Process/Outcome 的 Configuration、Pack、两个
Replica、Review references 和所有逐项结果。它可提供旧 11-item public Layer 5 的 compatibility projection，但
不得从 Process 完整结果删除 `contribution_value` artifact，也不得让 compatibility projection 成为新的 authority。

Suite attachment 前后 canonical Hard Outcome digest 必须相同。Suite/Pack/Replica/Review artifacts 使用 private
immutable retention；Evidence Bundle replay 必须验证引用、payload digest、权限、model-visible projection policy 和
每项 Evidence closure，并从 immutable Source Pack 重建两个 Model-Visible Pack、从 Replicas 重建 Review、从 Views
重建 compatibility projection。completion marker 必须绑定 Trial revision、Suite、两个 Review 和 model-input digests。

每次双 View 执行共享一个独立 `judgeExecutionId`；Replica artifact identity 必须包含它，Review identity 必须包含
两个 Replica references。同一 Trial/Configuration 的独立复测因此追加 artifact，不覆盖或碰撞既有执行。

## Deterministic 与 LLM authority

| Deterministic projection | LLM Judge |
| --- | --- |
| Message/Delivery/Run 是否存在、身份绑定、settlement、coverage、content digest | delegation 是否必要、handoff 是否清晰 |
| Message identity 去重、fanout interaction、稳定 interaction ordinal、Message/Delivery/Ledger attribution | contribution 与后续交付在语义上是否相关 |
| local Evidence closure、内容 allowlist、blinding 与 leakage | contribution 是否有任务价值 |
| Check result、workspace change、final response exact content | feedback 是否被吸收、Lead 是否正确整合 |
| Replica schema、引用闭包、disagreement 与 non-interference | solution fit、implementation quality、verification adequacy、claim/limitation semantics |

LLM 不得判断 Hard Check 是否通过、Evidence 是否存在、是否发生 Human Intervention、是否 settled，也不得从缺失
Evidence 推断 negative fact。

## Measurement limitation

Process/Outcome 分离不构成 Team superiority、collaboration uplift、role causality 或 statistical significance。
这些主张需要独立的 paired Team/Solo counterfactual protocol；Outcome Judge 只能作为其中一个 blinded semantic
measurement，不能替代配对 Hard Outcome、预算、时延和 validity 分析。

## References

- [ADR-0155](../adr/0155-treatment-blind-outcome-and-process-judge-views.md)
- [Benchmark Protocol v3](benchmark-protocol-v3.md)
- [Benchmark Protocol architecture](../architecture/benchmark-protocol.md)
- [ADR-0098](../adr/0098-dual-replica-evidence-bound-semantic-judge.md)
