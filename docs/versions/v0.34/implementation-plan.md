---
document_type: implementation-plan
version: v0.34
authority: implementation-status
status: in_progress
last_updated: 2026-08-04
---

# v0.34 实施与验收计划

## Checkpoint 1：冻结设计与 schema

- [x] 冻结 Hard Outcome、Evaluation Pending、Suite denominator 与历史不可变边界。
- [x] 冻结 ADR-0099 独立 Member Call 对 Collaboration Evidence 的约束。
- [x] 冻结五层报告、Evidence schema family、Judge schema family 与验收矩阵。
- [x] 将 v0.33 冻结为历史快照并更新唯一 current version 指针。

## Checkpoint 2：确定性 Trial vertical slice

- [x] 引入稳定 Requirement ID、criticality、Verification Catalog 与 Diagnostic Check。
- [x] Verifier process/result 使用封闭 schema，Runner 校验 exact Check set 和跨字段一致性。
- [x] 实现 `validity`、`evaluationState`、`hardOutcome` 三轴及 Evaluation recovery。
- [x] 实现 Delivered Workspace Freeze Barrier、不可变 Snapshot 和 append-only evaluation attempts / result revisions。
- [x] 生成 Layer 1、Layer 2 与空但合法的 Layer 3～5；完全不调用 LLM。
- [x] ACC-001～ACC-007 deterministic protocol fixtures 通过后才开始后续能力。

## Checkpoint 3：Core 原子执行预算

- [x] Public dispatch 接受通用 CampTurn Execution Budget 并在 root admission 原子冻结。
- [x] Member Call acceptance 在业务 effect 前原子占用 canonical A2A receipt 与 Run responsibility。
- [x] 实现 persistent deadline、monotonic timer、Budget Exhaustion、Turn fence 与 safe replay。
- [x] Runner watchdog 验证相同 deadline，时钟分歧转 Evaluation Pending。
- [x] 并发超限、restart、replay、partial-effect 负例和 ACC-008/023 通过。

验收证据：Core 274 个 library tests 全过；其中覆盖 root admission、accepted A2A / AgentRun
responsibility / elapsed exhaustion、并发最后一个 slot、restart deadline、fence 后 exact replay、
changed-payload conflict 与零部分业务 effect。Core binary 54 个自动测试全过（5 个手工 Runtime
smoke ignored），Unix socket bridge 在沙箱外复核通过；Qualification 45 个 deterministic tests、
Typecheck、Renderer 179 tests、Desktop build、Clippy `-D warnings` 与 rustfmt gate 通过。

## Checkpoint 4：隔离、人类介入与 Convergence

- [x] 实现 versioned Intervention Isolation Profile admission。
- [ ] 覆盖 Core control、Approval、配置、Runtime、process ancestry、workspace writer、network、Git
  remote 与 external MCP mutation。
- [x] Human Intervention 独立三态；External Effect Settlement 独立三态。
- [x] Convergence 分解为 Run、Input、Approval、budget、Runtime exit 和 external effect facts。
- [ ] ACC-004、ACC-009～ACC-011 通过。

当前部分实现：Formal Runner 在 Core 启动与 dispatch 前要求 private versioned Profile，校验封闭字段、
payload digest、Suite/Trial/Case binding、当前 POSIX identity/session，以及十类 channel 的完整 coverage
和最低 authority；冻结交付后再次校验 profile 与 identity continuity。Profile 缺失、权限不安全、
binding/digest/authority 不一致均在 preflight fail closed。投递后 continuity 丢失产生
`indeterminate`/Evaluation Pending；已观测人工控制仍优先产生 `present`。External effect 使用
`settled|unsettled|indeterminate`，不会从无记录猜测 settled。尚缺操作系统隔离策略的正式 fixture、
ledgered mutation effect receipt 与 ACC-004/009～011，因此整个 Checkpoint 仍未完成。

## Checkpoint 5：Evidence normalization 与 Ledgers

- [x] 冻结 Core evidence boundary，完整分页并验证 sequence/total/digest。
- [x] 实现 Evidence Index、稳定 Evidence Reference 和 authority/coverage propagation。
- [x] 实现 ADR-0099 Member Call lifecycle、latency segments、depth、duplicate/cycle/route facts。
- [x] 实现 Tool Call Ledger 与 Workspace Mutation Ledger，不提升弱 authority。
- [ ] 实现 typed mutation verification、effect identity 与 direct-failure causality boundary。
- [x] ACC-020、ACC-021、ACC-024 protocol/Core fixtures 通过。

当前部分实现：Runner 已冻结每个 AgentRun 的 `throughSequence`，完整分页并验证 sequence、ID、cursor
和 declared total；Core 已持久化 Team Tool terminal result 的 canonical identity、authorization、
error、replay 与 receipt。Tool diagnostic ledger 只接受明确的 Runtime action type，普通消息和未知
activity 不会被猜成 Tool；Runtime telemetry completeness 未受证明时 coverage 保持 `partial`，
authoritative totals 保持 `null`。Evidence Index 现以 artifact envelope 保存八个冻结 source boundary，
为 Core/Runner/Verifier/Runtime/Workspace/derived fact 建立稳定 record 与 reference；derived record 必须
引用同一 Index 内已存在的 source record，并精确传播 `complete|partial|unavailable|not_applicable`，
不能提升 coverage。Index artifact 追加保存，根文件只作为 current projection；Tool call 与 Final
Response 已绑定 Evidence Reference。Collaboration Ledger 以每个 canonical acceptance 为独立前向边，
Tool Call Ledger 保留 per-field coverage，Workspace Mutation Ledger 只从最终 tree diff 发布净变化、
before/after digest 与 typed diff verification。三者均以不可变 artifact 追加保存、在 recovery 时重建并
由公开 allowlist 仅导出 summary。尚缺完整 writer chronology、effect identity、Tool-to-Mutation 精确关联
与 direct-failure causality，因此整个 Checkpoint 仍未完成。

## Checkpoint 6：Bundle、报告与安全导出

- [x] Private Evidence Bundle 使用封闭 manifest、原子 completion marker 和 current-user-only 权限。
- [x] 五层报告不生成 mixed score，partial Suite 不生成 final Pass Rate。
- [x] public export 使用 allowlist builder；historical reader 保持原 Overall/schema。
- [x] secret canary、forbidden field、unresolved reference 和 unsupported schema fail closed。
- [x] ACC-017～ACC-019、ACC-025 protocol fixtures 通过。

实现还增加独立 `qualification:bundle:verify`：它不信任 current projection，而是重新校验 immutable
Manifest bytes、completion marker、cataloged JSON Schema、role-to-artifact identity、Evidence Reference
closure、`0600` 权限、public/Judge secret scan、Hard formula 和 Judge 不可补偿边界。

## Checkpoint 7：Semantic Judge 实验层

- [x] 冻结并 digest model snapshot、prompt、rubric、parameters、schema、redaction、retry 和 reconciliation。
- [x] 构建 visibility-preserving Judge Evidence Pack，untrusted evidence 明确分隔。
- [x] 实现两个 tool-disabled、counterbalanced Replica 与 exact checklist validation。
- [x] 实现 complete、abstain、disagreement、unavailable，不投票、不平均、不选择性重试。
- [x] 证明不同 Judge 状态下 Layer 1 canonical payload 与 digest 不变。
- [x] ACC-012～ACC-016、ACC-022 protocol fixtures 通过。

这里的 `[x]` 表示协议实现与 deterministic fixture 完成。仓库 fixture adapter 不冒充 LLM；Formal
Review 仍要求由仓库外部提供 `tool_disabled_external_sandbox` assurance。

## Checkpoint 8：全量回归与发布

- [x] JSON Schema meta-validation、fixture validation 与跨 artifact invariant tests 全部通过。
- [x] Qualification unit/integration tests、Core workspace tests、Typecheck、Renderer tests、Desktop build、
  clippy 和 formatting gates 通过。
- [x] public demo Evidence Bundle 可复现。
- [ ] 至少一组满足 ADR-0094 的隔离 Formal Trial Evidence Bundle 可复现。
- [ ] [验收矩阵](acceptance-matrix.md)全部通过并记录版本化证据。
- [ ] README 的 `implementation_status` 只在上述事实成立后改为 `complete`。

回填复核（2026-08-04）：`demo-v034-final-20260804` 得到 `valid + complete + hard pass`，3/3 Requirement，
324 条 Index record、4 个真实 Tool observation、2 个 final-diff-verified Mutation、0 个 accepted Call、
Read Model 18 / Protocol 4 和零残留 Runtime。追加 Judge fixture 后，独立 verifier 验证 12 个 present
artifact role、Bundle Manifest digest `sha256:0e6be4b80b79b9afa284bb144a45960dbf1711b3b711a9ad973a5987887e38ea`
以及不变 Hard Outcome。invalid preflight `invalid-v034-final-20260804` 仅保留 Trial 与 public export 两个
present role，其他 role 显式 unavailable/not-applicable，且 Core 未启动。

25 项 registry 与 protocol fixture 已自动化；但冻结矩阵要求每个 Formal fixture 运行于 dedicated
identity/session。当前执行环境是共享登录，ADR-0094 明确禁止将其、operator promise、自声明 Profile
或普通 host tree diff 当作 Formal 证明。因此 release matrix 与 `implementation_status` 仍未关闭。

## 实施顺序约束

Checkpoint 2 是首个不可跳过的 vertical slice。Checkpoint 7 不得与它并行接入生产路径；在确定性
Hard Outcome 和安全 allowlist export 成立前，Judge 只能使用离线 fixture 开发。不得通过降低
Verifier、Isolation、Evidence 或 Hard Gate 口径来使 Judge 或 Suite 演示通过。
