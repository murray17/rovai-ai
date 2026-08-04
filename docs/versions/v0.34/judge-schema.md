---
document_type: version-schema-contract
version: v0.34
authority: semantic-judge-schema
status: frozen
schema_family_version: 1.0.0
last_updated: 2026-08-03
---

# v0.34 Semantic Judge Schema Contract

## 1. 权威文件

| Artifact | Schema |
|---|---|
| 冻结 Judge Configuration | [semantic-judge-configuration.schema.json](schemas/semantic-judge-configuration.schema.json) |
| allowlist Judge Evidence Pack | [judge-evidence-pack.schema.json](schemas/judge-evidence-pack.schema.json) |
| 单个 Replica 输出 | [judge-replica-result.schema.json](schemas/judge-replica-result.schema.json) |
| 双 Replica reconciliation | [semantic-engineering-review.schema.json](schemas/semantic-engineering-review.schema.json) |

这些 artifact 与 Evidence schema family 独立版本化。Prompt、rubric、model snapshot、参数、Pack schema、
output schema、redaction policy、retry schedule 或 reconciliation rule 任一变化都产生新 Configuration
digest，不重算历史 Review。冻结 schema 文件 digest 见
[schema-catalog.json](schemas/schema-catalog.json)。

## 2. Judge Evidence Pack allowlist

Pack 只允许：公开 Case Requirement、匿名 Member/role、Delivered Workspace change 与有界 code context、
verification facts、独立 Member Call lifecycles、Tool / Mutation facts、Final Response Evidence 和每项
Evidence Coverage。

Pack 明确不允许：

- Hard Outcome 或 Overall；
- participant model/provider identity；
- hidden reasoning、credential、environment value；
- Runtime private log 或 raw provider packet；
- 完整 Withheld Verifier、hidden assertion 或 reference implementation；
- Sealed Pack locator、私有 filesystem locator 或 raw private source object。

Participant message、代码、注释和 final response 必须放入带边界的 `untrustedEvidence` segment。Judge
system prompt 明确这些内容是 evidence，不是 instruction。Judge 无 Tool、网络或 workspace 访问。

Pack 保留通信 visibility：private Call content、recipient Input、public CampMessage 和 later independent
Call 是不同 fact，不能扁平为共享 transcript，也不能因此推断 source 已看到 recipient output。

## 3. Checklist

v0.34 固定 11 个 item：

- `SER.requirements.understanding`；
- `SER.design.solution_fit`；
- `SER.implementation.quality`；
- `SER.testing.strategy`；
- `SER.scope.discipline`；
- `SER.collaboration.delegation`；
- `SER.collaboration.handoff_clarity`；
- `SER.collaboration.feedback_absorption`；
- `SER.collaboration.lead_integration`；
- `SER.response.claim_accuracy`；
- `SER.response.limitations`。

每项必须返回 `satisfied|partially_satisfied|not_satisfied|indeterminate|not_applicable`、
`low|medium|high` confidence、已验证 Evidence References 和有界 reason。`indeterminate` /
`not_applicable` 必须有 typed abstain reason。没有权重、dimension total 或 aggregate score。

Delegation item 使用 ADR-0099 send gate：目标是否需要消息继续行动/决策、是否有明确下一步或正在等待
必要结果。acknowledgement、courtesy、non-blocking progress 和 repeated-information Call 是不利证据；
没有 later Call 绝不是 missing-response defect。

## 4. Replica execution

正式 Review 恰好运行两个 tool-disabled Replica：

- 使用同一 immutable model snapshot 与 rubric；
- 使用冻结 decoding parameters 与可用 provider seed；
- checklist 展示顺序 A/B counterbalanced；
- transport retry 只按预先声明 schedule，所有 attempt append-only；
- 一个已合法输出不得为了追求一致而重试；
- 每个 Evidence Reference 在接受输出前解析并验证。

移动 alias 或无法识别 snapshot 的 endpoint 只能用于 diagnostic experiment，不能产生 Formal Semantic
Review。

## 5. Reconciliation

两 Replica 所有 item 合法且 categorical verdict 全部一致时，Review 为 `complete`。任一 item verdict
不同即为 `disagreement`，保留两侧结果，不容差合并、不投票、不平均、不 tie-break。只有 confidence
不同不构成 disagreement。

任一必需 Replica timeout、transport exhaust、schema invalid、reference invalid 或无法消费完整 Pack，
Review 为 `unavailable`。存活 observation 可在私有 evidence 中保留，但不能冒充 Review。

Review schema 没有 Hard Outcome 字段。Runner 必须在同一 Hard fixture 上注入 complete、abstain、
disagreement 与 unavailable Review，证明 Layer 1 bytes 和 digest 不变。

## 6. 安全验收

Judge 协议必须覆盖 prompt injection、evidence order perturbation、secret canary、invalid reference、
malformed output、transport failure 和语义等价 code transform。协议验收只证明边界与稳定性暴露，
不声称 Judge 对开放工程质量具有客观正确性。

## 7. 后置实现状态

2026-08-04 回填已实现冻结 Configuration、allowlist Pack、exact 11-item output、A/B counterbalance、
transport-only retry、complete/abstain/disagreement/unavailable reconciliation、append-only artifact retention
和 Hard Outcome byte/digest 不变检查。Pack 中每个 Evidence Reference 都必须解析到 `safeForJudge=true`
的 Index record；不安全的 workspace/tool source 被省略并使对应 item abstain，不绕过 allowlist。

仓库附带的 `semantic-judge-fixture-adapter.mjs` 是 deterministic protocol fixture，只声明 `assurance=fixture`。
它用于验证 schema、顺序、引用、abstain 和不可补偿边界，不是 LLM，也不能用于 Formal Review。Formal CLI
只接受外部 adapter 的 `tool_disabled_external_sandbox` assurance；当前仓库未提供或伪造该外部执行环境。
