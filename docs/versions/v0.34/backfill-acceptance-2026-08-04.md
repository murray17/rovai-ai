---
document_type: acceptance-record
version: v0.34
authority: post-historical-backfill-evidence
status: partial
recorded_at: 2026-08-04
product_baseline: v0.35
---

# v0.34 后置回填验收记录（2026-08-04）

本记录在 v0.35 产品基线上补齐 v0.34 Benchmark evaluator，不改变 v0.35 的 current 状态，也不重写
v0.31 / v0.32 Trial。Member Call 始终使用 ADR-0099 独立前向边；没有 ReturnPolicy、Return Obligation、
Call Outcome、自动回联或 response-closure 门禁。

## 已完成实现

- schema catalog `1.3.0`：21 个 Draft 2020-12 schema 全部按 raw bytes digest 校验与编译；新增 Trial /
  Environment `1.1.0`，允许 invalid、pending 和 demo 不伪造 unavailable artifact；
- Case、Catalog、Snapshot、Verifier、Environment、Trial 的 schema-valid normalized artifact；
- Evidence Index、Collaboration Ledger、Tool Call Ledger、Workspace Mutation Ledger；
- 封闭 Evidence Bundle Manifest、immutable bytes completion marker、`0600` artifact retention；
- 五层 allowlist Public Report、历史 Overall 保留、partial Suite denominator gate；
- exact 11-item Semantic Judge Configuration / Pack / A/B Replica / Review，transport-only retry，typed
  abstain、disagreement、unavailable 与 Hard byte/digest independence；
- 独立 Bundle closure verifier；
- ACC-001～ACC-025 executable fixture registry，digest
  `sha256:787d09c9749fe33278a5ec782d206dd87cbdf69a218adac78f1094195a440f86`。

## Public demo

Trial `demo-v034-final-20260804`：

- Layer 1：`valid / complete / delivery pass / convergence pass / human absent / overall pass`；
- Delivery：3/3 Requirement；
- Collaboration：1 Run，0 accepted Call；
- Tool：4 个 observed success；Runtime telemetry completeness 未受证明，因此 authoritative totals 保持
  `null`；
- Mutation：2 个 final-diff-verified net mutation，writer chronology 保持 partial；
- Evidence Index：324 records；
- Environment：Core `0.0.1`、Read Model schema 18、Attested Team Protocol 4；
- Bundle：12 个 present role，Isolation Profile 为 `not_applicable`，Manifest digest
  `sha256:0e6be4b80b79b9afa284bb144a45960dbf1711b3b711a9ad973a5987887e38ea`；
- 进程复核：Core、Runner、Runtime 无残留。

随后使用 deterministic fixture adapter 验证 Judge 协议：Review
`semantic-engineering-review:6a85e083aafe646463caa5b69455225f` 为 complete；4 项 satisfied、3 项
indeterminate、4 项 not_applicable。该 adapter 声明 `assurance=fixture`，不是 LLM，不构成 Formal
Semantic Review。追加 Review 前后的 Layer 1 保持 Hard Pass，独立 Bundle verifier 通过。

Invalid preflight `invalid-v034-final-20260804` 以 exit 2 结束，`dispatchAccepted=false`、
`invalid / pending / unavailable`；Bundle 只包含真实存在的 Trial 与 public export，Manifest digest
`sha256:53b216d715abded02bf252afb39a788415e777bfa42dc3865b8de6afd370b813`。

## 自动化回归

- Renderer：179 / 179；
- Qualification：66 / 66；
- Core library：279 / 279；
- Core binary：55 个普通自动测试通过，Unix socket bridge 在沙箱外单测通过，5 个真实 Runtime smoke
  保持 ignored；
- `cargo clippy --workspace --all-targets -- -D warnings`、`cargo fmt --all -- --check`、`pnpm typecheck`、
  `pnpm build:desktop` 全部通过；
- Bundle verifier 对最终 public demo 与 invalid preflight 均通过。

## 未关闭的冻结门禁

本记录不把协议 fixture 写成完整 release acceptance。当前共享登录与普通 host session 不满足 ADR-0094：
它不能证明无其他 writable process、完整 process ancestry、网络/Git/MCP mutation policy 或整个投递后
区间的 observation continuity。自声明 JSON Profile、operator promise、开始/结束 tree diff 或 demo
临时 HOME 都不能提升为 Formal isolation。

因此以下门禁保持开放：

- 至少一组 dedicated identity/session 下的隔离 Formal Trial Evidence Bundle；
- 外部 `tool_disabled_external_sandbox` Judge adapter 的 Formal Review（若正式验收要求 Judge complete）；
- 完整 writer chronology、effect identity 与 direct-failure causality authority；
- 所有标记 Formal 的 acceptance fixtures 在上述环境内重放。

结论：v0.34 evaluator 与 Judge protocol 的历史回填已实现并通过 deterministic/public-demo 验收；v0.34
release completion、Formal Pass Rate 和 `implementation_status=complete` 不成立。该保守结论是冻结
Hard / Semantic authority 边界的直接结果，不通过降低门禁或伪造隔离证据关闭。
