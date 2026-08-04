---
document_type: version-schema-contract
version: v0.34
authority: benchmark-evidence-schema
status: frozen
schema_family_version: 1.3.0
last_updated: 2026-08-03
---

# v0.34 Evidence Schema Contract

## 1. 权威文件

本目录的 JSON Schema 是 v0.34 Evidence artifact 的机器可校验合同：

冻结的文件字节 digest 见 [schema-catalog.json](schemas/schema-catalog.json)。

| Artifact | Schema |
|---|---|
| 共享类型 | [artifact-envelope.schema.json](schemas/artifact-envelope.schema.json) |
| Qualification Case | [qualification-case.schema.json](schemas/qualification-case.schema.json) |
| Verification Catalog | [verification-catalog.schema.json](schemas/verification-catalog.schema.json) |
| Qualification Environment Manifest | [qualification-environment-manifest-v1.1.schema.json](schemas/qualification-environment-manifest-v1.1.schema.json) |
| Intervention Isolation Profile | [intervention-isolation-profile.schema.json](schemas/intervention-isolation-profile.schema.json) |
| Delivered Workspace Snapshot | [delivered-workspace-snapshot.schema.json](schemas/delivered-workspace-snapshot.schema.json) |
| Trial lifecycle 与五层引用 | [qualification-trial-v1.1.schema.json](schemas/qualification-trial-v1.1.schema.json) |
| Verifier Observation | [verifier-observation.schema.json](schemas/verifier-observation.schema.json) |
| Evidence Index | [evidence-index.schema.json](schemas/evidence-index.schema.json) |
| Collaboration Ledger | [collaboration-ledger.schema.json](schemas/collaboration-ledger.schema.json) |
| Tool Call Ledger | [tool-call-ledger.schema.json](schemas/tool-call-ledger.schema.json) |
| Workspace Mutation Ledger | [workspace-mutation-ledger.schema.json](schemas/workspace-mutation-ledger.schema.json) |
| Evidence Bundle Manifest | [evidence-bundle-manifest.schema.json](schemas/evidence-bundle-manifest.schema.json) |
| Suite Summary | [qualification-suite.schema.json](schemas/qualification-suite.schema.json) |
| 脱敏五层公开报告 | [public-benchmark-report.schema.json](schemas/public-benchmark-report.schema.json) |

Judge 专用 artifact 见 [judge-schema.md](judge-schema.md)。所有 schema 使用 JSON Schema 2020-12，
对象默认封闭；版本号变更与文件 digest 一起构成 schema identity。

## 2. Artifact envelope

每个 artifact 必须声明：

- 固定 `schemaId` 和 `schemaVersion`；
- producer ID、version 与 executable/config digest；
- Case / Trial / Suite binding；
- 构建该 payload 所消费的 source boundaries；
- 按冻结 canonical JSON 算法计算的 `payloadDigest`；
- 封闭 `payload`。

`payloadDigest` 只覆盖 payload，避免自引用。Bundle Manifest 自身的 digest 由外层原子 completion
marker 记录。Canonical JSON 算法在实现时必须冻结为独立版本；v0.34 不允许使用平台默认 key
ordering 或浮点序列化作为 identity。

## 3. Stable ID 与 Evidence Reference

Requirement、Check、Evidence、Call、Tool、Mutation、Failure Fact、Artifact 和 planned Suite slot 都有
稳定 ID。JSON Schema 校验形状；Runner 另行验证同一 namespace 内唯一性。

Verification Catalog schema `1.1.0` 明确冻结每个 Check 的 `observationAuthority`，并要求
Runner-owned Check 声明受支持的 `runnerCheck`。这是对 `1.0.0` 缺失的 authority discriminator
所作的向前版本修正；旧文件 digest 仍可从对应 Git 历史恢复，不原地冒充同一 schema identity。

Tool Call Ledger schema `1.1.0` 为 `retryRelation.kind` 增加 `indeterminate`。`1.0.0` 只允许
`original|retry|idempotent_replay`，会迫使缺少 retry authority 的 Runtime observation 被猜成
`original`，违反本版本“不可靠则 indeterminate”的边界。Builder 不会把 `indeterminate` 计入 retry
或 original totals；旧 schema 文件字节仍由对应 Git 历史恢复。

Qualification Trial schema `1.1.0` 允许 invalid / pending attempt 把尚不存在的 Snapshot、Verifier、
Index、Ledger 与 Review 引用显式保留为 `null`，并只对 `valid + complete` 强制完整交付引用。Environment
Manifest schema `1.1.0` 允许 demo 的 Isolation Profile 为 `null`，并把无法证明的 Git remote policy
表示为 `indeterminate`。这两个前向修正避免 v1.0 通过伪造 artifact 来满足必填字段；旧文件与 digest
继续保留在 catalog 中，不原地重写。

Evidence Reference 由 `artifactId + evidenceId + optional path` 构成。它必须解析到同一 Bundle 的
Evidence Index，且 target coverage 足以支持引用方。Judge Pack 使用重新允许列表投影后的稳定
reference，不能直接暴露 private locator。

## 4. Completeness 与 indeterminate

`complete` 只能由声明 authority 和连续 source boundary 建立。Snapshot 的有界事件窗口、缺页、
sequence gap、clock domain 不可比或 Runtime 未提供字段时必须记录 `partial|unavailable` 与 reason。
缺失数据不能序列化为 `false`、`0`、空数组或成功。

Hard authority gap 使 Trial Evaluation Pending。Diagnostic gap 只使对应 metric 或 finding
indeterminate。每个 derived fact 和 rate 必须保留输入 Evidence References；覆盖不兼容时 rate 为
indeterminate，不用已观察子集作分母。

## 5. Verification invariants

除 schema 校验外，Runner 必须证明：

1. Trial、Case、Catalog、Snapshot 和 Verifier digests 一致；
2. 每个 Catalog Check 恰好出现一次且无未知 ID；
3. Check kind、category、Requirement references 与 Catalog 一致；
4. 所有公开 Delivery Requirement 至少由一个 Hard Check 覆盖；
5. `criticality` 不影响门禁；任一 Requirement 的 Hard Check 未通过即 Requirement fail；
6. Diagnostic Check 不进入 Verified Delivery；
7. `valid + complete` 才允许 Hard pass/fail；invalid 或 pending 必须 unavailable；
8. Overall 严格等于三项 Hard Gate 公式；
9. failure stage 由时间与 source sequence 的确定性规则导出，不由 Agent 或 Judge声明；
10. Suite final Pass Rate 只在全部 planned Formal slots scorable 时存在。

## 6. Collaboration invariants

每个 Collaboration Ledger record 对应一个 canonical Member Call acceptance receipt。A2A 数量是这些
唯一 receipt 的数量，不是 A2A AgentRun 数量。

Call 的 mechanical settlement 只取决于关联 Input 与 recipient Run；recipient terminal 且没有任何
后续 Call 是合法 settled。任意方向的后续 Call 必须拥有新的 Call ID、receipt、slot 和 depth。

Schema 和 builder 必须拒绝以下字段及同义迁移字段：`returnPolicy`、`returnObligation`、
`callOutcome`、`responseProduced`、`sourceReceived`、`responseClosure`、`sourceResume`、
`conversationInputKind`。

## 7. Tool 与 Mutation invariants

- canonical Tool identity 只在 Core 或受证明映射提供时填写；
- idempotent replay 指向原 call 且不产生新 acceptance/effect；
- duplicate side effect 只在 authoritative effect identity/receipt 证明时为 `proven_duplicate`；
- latency 只在同一 clock domain 或冻结 correlation interval 中计算；
- mutation verification 是到 later read-back/diff/test/build/receipt 的 typed relation；
- Tool failure 只有被 authoritative Failure Fact 显式引用时才可标记为直接失败原因；
- Workspace overlap 只有在完整 writer coverage 下才是客观事实。

## 8. Bundle 与导出

Private Bundle Manifest 为每种必需 artifact 保留唯一 role entry。pre-dispatch attempt 或 evidence
gap 没有对应 artifact 时，entry 必须显式为 `unavailable|not_applicable` 并给出 typed reason，不能
伪造 Snapshot 或用缺失字段表示。所有 evaluation attempts 追加保存，不能覆盖旧 attempt。

公开导出使用独立 allowlist schema；不得把整个 Bundle 先序列化再字符串脱敏。credentials、环境
变量值、Runtime private logs、hidden reasoning、完整 Withheld Verifier、reference implementation 和
Sealed Pack locator 在 public / Judge schema 中没有字段。

确定性 vertical slice 将 `evaluation-attempts/` 与 `result-revisions/` 作为追加式历史权威；每个
result revision 记录前一 revision、对应 evaluation attempt 与完整 result digest。根目录的
`result.json` 和 `redacted-summary.json` 只是由最新 revision 重建的 current projection。
Evidence Index 同样按 artifact ID 追加保存于 `evidence-indexes/`；根目录 `evidence-index.json` 只是
current projection。每个 result revision 绑定自己的 Index artifact reference，Evaluation recovery
必须创建新 Index 并重绑定新派生 reference，不能改写旧 artifact。
Collaboration、Tool Call 与 Workspace Mutation Ledger 分别追加保存于 `collaboration-ledgers/`、
`tool-call-ledgers/` 与 `workspace-mutation-ledgers/`；同名根文件同样只是 current projection。Ledger
Builder 必须只消费当前 Evaluation 对应的 Index reference domain；recovery 不得复用旧 Index 的引用。
`CAPTURE_COMPLETE` 永久绑定首个 result revision；恢复成功可以新增 `COMPLETE`，但不得删除或改写
原 `EVALUATION_PENDING` 证据。投递后评测缺口被证明不可恢复时，显式 invalidation 另行追加
`IRRECOVERABLE` marker，绑定 Invalid result revision digest；该操作必须引用一个已有的失败 recovery
attempt 和其中完全相同的 typed reason，不能由当前 projection 或操作员自由文本单独触发。
