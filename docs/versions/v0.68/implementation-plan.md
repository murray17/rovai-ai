---
document_type: implementation-plan
version: v0.68
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-13
---

# v0.68 实施与验收计划

## Checkpoint 0：测量构念与权威边界

- [x] 定义 Opportunity、Tool Interaction Measurement、Prepared Fixture、Tool-Use Judge、Resource Profile、
  Paired Collaboration Experiment 与 Outcome-Conditioned Efficiency；
- [x] 冻结 deterministic/LLM 分工、Hard Outcome non-interference、missing/coverage 与 no aggregate score；
- [x] 接受 ADR-0171、ADR-0172 和两个字段级合同。

## Checkpoint 1：Core Canonical Operation Evidence

- [x] 为 Camp read/search、Memory search/read/create/revise 与 Camp message send 生成 closed/bounded canonical input/result；
- [x] 投影绑定 raw input/output digests，禁止凭据、raw transcript、无限正文与 Agent model context 回流；
- [x] 在 Built-in effect 前 durable 写入 authenticated start fence，terminal 投影不重复计数，并以此关闭 invocation coverage；
- [x] 覆盖 exact field allowlist、length/cardinality caps、unknown operation 和泄漏负向测试。

## Checkpoint 2：Tool Interaction Measurement

- [x] 实现 Opportunity/trace/adapters/oracle/coverage 的纯构建与严格 validator；
- [x] 使用 Core evidence、Evidence Index 与现有 Collaboration authority 绑定 A2A effect；
- [x] 保留 immutable measurement artifact、source digest、prepared fixture manifest reference 与 deterministic findings；
- [x] 覆盖 forced/natural/non-use control、missing evidence、duplicate/replay、fanout 与 stale revision。

## Checkpoint 3：独立 Tool-Use Judge

- [x] 构建 treatment-blind model-visible Pack 与 audit-only local Evidence Map；
- [x] checklist 覆盖 selection necessity、input strategy、result interpretation、downstream use、retention quality；
- [x] 实现双 Replica、reverse order、exact closure、disagreement/abstention、immutable review 和 replay；
- [x] 证明 hidden oracle/deterministic verdict/raw payload 不进入模型，Hard Outcome attachment 前后 digest 不变。

## Checkpoint 4：Resource Measurement 与 paired protocol

- [x] 实现 typed measure、authority/coverage、clock/interval/aggregation compatibility validator；
- [x] 实现 Team/Solo manifest、treatment diff、fresh-state/order/holdout admission 与 arm references；
- [x] 实现 outcome stratum、blinded outcome compatibility、outcome-conditioned delta/ratio 和 no faster-failure reward；
- [x] 报告 raw vector、exclusions/indeterminate，不生成 global winner、Pass@k 或 weighted score。

## Checkpoint 5：Case、Runner 与 CLI 接线

- [x] 增加 sealed Measurement Spec/fixture/oracle admission 与 symbolic fresh-state materialization；
- [x] Qualification Runner 记录 treatment、pre-dispatch fixture、monotonic interval 和 measurement source references；
- [x] 提供单 Trial measurement/Tool-Use Review 与 single-entry paired experiment CLI；
- [x] Bundle/replay 验证 retained source、projection closure、completion marker 和 exact treatment binding。

## Checkpoint 6：校准、holdout 与完整门禁

- [x] 离线 fixture 覆盖 Camp retrieval、Memory retrieval/mutation、A2A、non-use control 与 adversarial leakage；
- [x] fixture Judge 验证 agreement/disagreement/unavailable，而不冒充真实 LLM quality；
- [x] 预注册 development/holdout 和 paired estimand；记录真实 Trial 仍需 private dedicated isolation；
- [x] 运行 Rust、Node/Benchmark、Schema、docs generated history、diff-aware CI 与 full repository gates。

## 当前证据

已执行并通过：

- `cargo test -p rovai-core --lib`：388 passed；
- `cargo test -p rovai-core --bin rovai-core`：69 passed，3 ignored（manual Runtime smoke）；
- `cargo clippy -p rovai-core --lib --bin rovai-core -- -D warnings`、`cargo fmt --all -- --check`；
- `node --test scripts/lib/*.test.mjs ... scripts/benchmark/**/*.test.mjs`：220 passed；
- `vitest run`：47 files / 311 tests passed；`tsc --noEmit`；
- cross-version schema catalog、generated ADR history、version/ADR governance 与 diff check。

这些结果证明协议 closure、replay、negative fixtures 与实现回归，不等于真实 LLM Judge 准确率、Team 优于 Solo、
Formal isolation 或统计显著性。真实 claim 必须另行运行预注册 private holdout paired Trials。
