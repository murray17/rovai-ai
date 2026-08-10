---
document_type: interface-contract
contract: benchmark-protocol
version: 3
authority: benchmark-run-envelope-and-comparability
status: accepted
last_updated: 2026-08-10
---

# Benchmark Protocol v3

Benchmark Protocol v3 是跨版本 Benchmark Run 的字段级合同。JSON Schema 位于
[`benchmark-run-v3.schema.json`](../versions/v0.53/schemas/benchmark-run-v3.schema.json)，运行时 Writer/Validator
位于 `scripts/benchmark/protocol/`。本合同不改变 v0.34 Hard Outcome，也不把 Trial、Verifier 或成绩迁入
Rust Core。

## 信封与身份

Writer 只写 `schemaVersion: 3`、`benchmarkProtocolVersion: 3.0.0`。未知 major 必须 fail closed。
信封包含：

- `profile`：`id/version/lane` 以及 Profile、Hard Outcome 定义和发布策略摘要；
- `suite`：`id/version/definitionDigest/caseSetDigest` 以及由 Profile 给出的 round、case、slot 数；
- `verification`：Case Seal 集合、Verification Catalog、Change Boundary 和 Budget Contract 摘要；
- `productContract` 与 `executionEnvironment`；
- `outcome`、五层 `evidence`、`comparisonEligibility`、`artifactIndex`、`disclosure` 和 `integrity`；
- derived projection 可增加 `derivedFrom.sourceArtifactDigest/sourceSchemaVersion/adapterId`。

`integrity.payloadDigest` 覆盖除 `integrity` 本身外的完整 payload；`contentIdentityDigest` 另外排除
`runId`、记录时间和嵌套 observation 时间/attempt identity。随机 ID 和时间戳因此不能改变内容寻址身份。
Canonical JSON 按 key 排序，不接受 `undefined`、非有限数字或非 JSON 对象。

## Product Contract Fingerprint

以下字段必须是 `{status: available, value, authority}` 或
`{status: unavailable, reason: {code}}`，不得从 Markdown 推断：

- release/build metadata、Git commit、Core executable digest；
- Data Contract version/schema、CampSnapshot schema；
- ContextManifest、Context Formatter、Context Delivery Profile；
- Durable Task contract version/source digest、Built-in Transport version、Built-in Catalog digest；
- accepted-only Context ACK source contract。

代码常量、Git object、build metadata、Core `health.check` 和 executable bytes 是允许的权威来源。
缺少 Core executable 时其 digest 为 unavailable；缺少已验证 Core health evidence 时 Catalog 真正的 canonical
digest 为 unavailable，可同时保留不冒充 Catalog digest 的 source compatibility digest。

## Execution Environment

`executionEnvironment` 必须保留原 `teamRuntimeCompatibilityDigest`，并把它纳入包含 Runner/Node/platform class、
Team Configuration、Runtime/模型/权限摘要、Isolation Profile 和 Case hermetic verification profile 的
`compatibilityEnvelopeDigest`。公开信封只保存摘要和非敏感分类，不保存绝对路径、环境变量值、凭据、Runtime
private root 或用户数据目录。

## Hard Outcome 与五层 Evidence

五层名称继续为 Hard Outcome、Delivery、Collaboration、Tool & Mutation、Semantic Review。只有 Layer 1
决定资格；Judge 永远不创造、阻塞、提升或降低 Hard Outcome。Team Qualification 的 Hard Outcome 仍只由
Verified Delivery、Orchestration Convergence、Post-Dispatch Human Intervention 及其 validity/evaluation state
决定。不同 Lane 可定义自己的确定性 conformance pass 条件，但不能将 Collaboration、Performance 或 Judge
加权补偿为综合总分。

## Adapter 与历史不可变性

Registry 固定公开 `qualification-suite-v032`、`qualification-suite-v034`、
`diagnostic-portfolio-v036`、`benchmark-protocol-v3`。Legacy reader 支持 Trial schema 1/2 和 Suite schema
1/2；v0.34 adapter 继续严格要求 `suite.version=v0.34`、3 rounds、4 cases。任何历史 artifact 不原地转换、
迁移或重算；derived v3 projection 必须引用原 source bytes 的 SHA-256。

## 比较资格

比较输出分别判断 `hardOutcome`、`collaboration`、`performance`、`evidenceIntegrity`、
`contractConformance`。每轴返回 `eligible`、稳定 `reasonCodes`、两端 relevant fingerprint、
`suppressedMetrics` 和 `displayOnlyMetrics`。不可比轴的 `delta` 必须为 `null`；原值可显示，但必须标明不得
解释为产品回归。

## Disclosure

Public Writer 拒绝绝对 Home/App data/SQLite/Runtime private root/Sealed Pack 路径，以及 credential、私有
Prompt、withheld verifier 和 reference answer 字段。私有 Bundle 继续由既有 Qualification allowlist 和权限
合同治理；公开投影不扩大私有材料边界。

## References

- [ADR-0151](../adr/0151-versioned-benchmark-protocol-and-axis-comparability.md)
- [Benchmark Protocol architecture](../architecture/benchmark-protocol.md)
- [v0.53 overview](../versions/v0.53/README.md)
