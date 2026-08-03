---
document_type: implementation-plan
version: v0.34
authority: implementation-status
status: not_started
last_updated: 2026-08-03
---

# v0.34 实施与验收计划

## Checkpoint 1：冻结设计与 schema

- [x] 冻结 Hard Outcome、Evaluation Pending、Suite denominator 与历史不可变边界。
- [x] 冻结 ADR-0099 独立 Member Call 对 Collaboration Evidence 的约束。
- [x] 冻结五层报告、Evidence schema family、Judge schema family 与验收矩阵。
- [x] 将 v0.33 冻结为历史快照并更新唯一 current version 指针。

## Checkpoint 2：确定性 Trial vertical slice

- [ ] 引入稳定 Requirement ID、criticality、Verification Catalog 与 Diagnostic Check。
- [ ] Verifier process/result 使用封闭 schema，Runner 校验 exact Check set 和跨字段一致性。
- [ ] 实现 `validity`、`evaluationState`、`hardOutcome` 三轴及 Evaluation recovery。
- [ ] 实现 Delivered Workspace Freeze Barrier、不可变 Snapshot 和 append-only evaluation attempts。
- [ ] 生成 Layer 1、Layer 2 与空但合法的 Layer 3～5；完全不调用 LLM。
- [ ] ACC-001～ACC-007 通过后才能开始后续能力。

## Checkpoint 3：Core 原子执行预算

- [ ] Public dispatch 接受通用 CampTurn Execution Budget 并在 root admission 原子冻结。
- [ ] Member Call acceptance 在业务 effect 前原子占用 canonical A2A receipt 与 Run responsibility。
- [ ] 实现 persistent deadline、monotonic timer、Budget Exhaustion、Turn fence 与 safe replay。
- [ ] Runner watchdog 验证相同 deadline，时钟分歧转 Evaluation Pending。
- [ ] 并发超限、restart、replay、partial-effect 负例和 ACC-008/023 通过。

## Checkpoint 4：隔离、人类介入与 Convergence

- [ ] 实现 versioned Intervention Isolation Profile admission。
- [ ] 覆盖 Core control、Approval、配置、Runtime、process ancestry、workspace writer、network、Git
  remote 与 external MCP mutation。
- [ ] Human Intervention 独立三态；External Effect Settlement 独立三态。
- [ ] Convergence 分解为 Run、Input、Approval、budget、Runtime exit 和 external effect facts。
- [ ] ACC-004、ACC-009～ACC-011 通过。

## Checkpoint 5：Evidence normalization 与 Ledgers

- [ ] 冻结 Core evidence boundary，完整分页并验证 sequence/total/digest。
- [ ] 实现 Evidence Index、稳定 Evidence Reference 和 authority/coverage propagation。
- [ ] 实现 ADR-0099 Member Call lifecycle、latency segments、depth、duplicate/cycle/route facts。
- [ ] 实现 Tool Call Ledger 与 Workspace Mutation Ledger，不提升弱 authority。
- [ ] 实现 typed mutation verification、effect identity 与 direct-failure causality boundary。
- [ ] ACC-020、ACC-021、ACC-024 通过。

## Checkpoint 6：Bundle、报告与安全导出

- [ ] Private Evidence Bundle 使用封闭 manifest、原子 completion marker 和 current-user-only 权限。
- [ ] 五层报告不生成 mixed score，partial Suite 不生成 final Pass Rate。
- [ ] public export 使用 allowlist builder；historical reader 保持原 Overall/schema。
- [ ] secret canary、forbidden field、unresolved reference 和 unsupported schema fail closed。
- [ ] ACC-017～ACC-019、ACC-025 通过。

## Checkpoint 7：Semantic Judge 实验层

- [ ] 冻结并 digest model snapshot、prompt、rubric、parameters、schema、redaction、retry 和 reconciliation。
- [ ] 构建 visibility-preserving Judge Evidence Pack，untrusted evidence 明确分隔。
- [ ] 实现两个 tool-disabled、counterbalanced Replica 与 exact checklist validation。
- [ ] 实现 complete、abstain、disagreement、unavailable，不投票、不平均、不选择性重试。
- [ ] 证明不同 Judge 状态下 Layer 1 canonical payload 与 digest 不变。
- [ ] ACC-012～ACC-016、ACC-022 通过。

## Checkpoint 8：全量回归与发布

- [ ] JSON Schema meta-validation、fixture validation 与跨 artifact invariant tests 全部通过。
- [ ] Qualification unit/integration tests、Core workspace tests、Typecheck、Renderer tests、Desktop build、
  clippy 和 formatting gates 通过。
- [ ] public demo 与至少一组隔离 Formal Trial Evidence Bundle 可复现。
- [ ] [验收矩阵](acceptance-matrix.md)全部通过并记录版本化证据。
- [ ] README 的 `implementation_status` 只在上述事实成立后改为 `complete`。

## 实施顺序约束

Checkpoint 2 是首个不可跳过的 vertical slice。Checkpoint 7 不得与它并行接入生产路径；在确定性
Hard Outcome 和安全 allowlist export 成立前，Judge 只能使用离线 fixture 开发。不得通过降低
Verifier、Isolation、Evidence 或 Hard Gate 口径来使 Judge 或 Suite 演示通过。
