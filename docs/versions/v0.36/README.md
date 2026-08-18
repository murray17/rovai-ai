---
document_type: version-overview
version: v0.36
lifecycle: historical
authority: version-scope-and-status
design_status: frozen
implementation_status: complete
last_updated: 2026-08-04
---

# Rovai-ai v0.36 Collaboration-Value Diagnostic Portfolio

> 中文名：协作价值诊断 Case 组合
>
> 状态：已完成；四个私有 Case admission、八个真实诊断 Trial、Completion 重验与全量回归均通过
>
> 前置版本：[v0.35 Native Session Member Identity Bootstrap](../v0.35/README.md)
>
> 跨版本决策：[ADR-0101](decisions.md#adr-0101)、
> [ADR-0102](decisions.md#adr-0102)
>
> 实施设计：[architecture.md](architecture.md)
>
> Case schema：[case-schema.md](case-schema.md)
>
> Portfolio schema：[portfolio-schema.md](portfolio-schema.md)
>
> 验收矩阵：[acceptance-matrix.md](acceptance-matrix.md)
>
> 实施门禁：[implementation-plan.md](implementation-plan.md)
>
> 公开结果：[DCP-001@1.0.1](../../../qualification/diagnostic/v0.36/results/DCP-001-1.0.1.json)

## 版本意图

v0.34 已建立五层 Benchmark Evidence 与 Semantic Judge 协议，但公开 demo Case 不足以判断
高强度工程 Case 是否真正可理解、可区分错误实现、可复现并适合观察团队协作。v0.36 新增四个
仓库外的 Collaboration-Value Qualification Case，并用一个独立 Diagnostic Portfolio 执行两次固定
重复，验证 Case 与证据链质量。

本版本不把协作活动变成 Hard Gate，也不声称团队协作优于单 Agent。Hard Outcome 继续由
[ADR-0095](../v0.34/decisions.md#adr-0095) 唯一决定；Portfolio
只报告每个 Trial 和每个 Case 的诊断结论。

## 四个固定 Case

| Case | 主题 | 三个独立工作方向 | Integration Invariant |
|---|---|---|---|
| `DC-001` | 多版本事件归一化管线 | v1/v2 归一化；identity 去重与冲突；稳定摘要与序列化 | batch 与任意 chunk 输入得到 byte-identical 输出且不修改输入 |
| `DC-002` | 并发幂等执行协调器 | canonical identity；并发 claim/conflict；receipt/recovery | 同 identity 并发 original/replay 最多一个受管副作用且 receipt 相同 |
| `DC-003` | 版本化状态迁移与旧数据保持 | v1/v2/v3 检测；逐步迁移；原子写入与 rollback | direct/step migration 得到 byte-identical v3，失败不改变源状态 |
| `DC-004` | 受限 Workspace Patch 事务 | path containment；确定性 plan；staging/atomic recovery | 全量提交或 byte-identical rollback，执行中也不得越过 root |

每个 Case 恰有六个公开 Delivery Requirement：前三个行为工作方向、一个 Integration Invariant、
一个 build/regression、一个 change boundary。Prompt 不出现 Member、角色、工作流、委派、Task、
`call_member` 或 handoff 提示。

## Case v3 质量门槛

- R1～R4 各有一个初始应失败的 Target Public Check 和至少一个不同输入或性质的 withheld Check；
- R5 有一个初始应通过的 Baseline Public Check；R6 只由 Runner tree comparison 判断；
- 五个公开 Check 在 reference workspace 全部通过；
- 至少三个精确 Challenge Mutant 覆盖 public-overfit、domain-edge、regression/boundary；
- 每个 Mutant 双物化后只失败声明的 Check，不能用 build failure 充数；
- public、withheld、reference 和 Mutant admission 使用相同 Hermetic Verification Profile；
- final change 仅允许 `src/**` 与 `tests/agent/**`；
- private Pack、reference、verifier 和 Mutants 永不进入 Git、Trial workspace、Judge Pack 或公开报告；
- Canary 或私有 locator 泄漏使 Portfolio `incomplete`，不得清理后重跑。

v2 Case 继续按历史合同读取和验证，不迁移、不改 Seal、不重算。v0.36 Portfolio 只接受 v3 Case。

## Portfolio 固定合同

- Portfolio ID：`DCP-001`；当前版本：`1.0.1`；
- 四个 Case 各两个固定 Repeat slot，共八个 Trial；
- 每个 Trial 使用全新的 Core、Camp、Conversation、Native Session、workspace 与 Runtime private root；
- 统一预算：`elapsedSeconds=900`、`maxAgentRuns=8`、`maxAcceptedA2a=7`；
- 团队固定为当前 Qualification Runner 的四成员、Runtime、模型、reasoning 与权限配置；
- Definition 在首个 Trial 前封存；Ledger append-only；Status 可重建；Completion 只生成一次；
- pre-dispatch Invalid 仅可在完全相同配置下 replacement-link；投递后不得重新运行团队；
- 两次 Hard Outcome Fingerprint 相同为 `stable_pass|stable_fail`，不同为
  `investigation_required`，不增加第三次；
- 不生成 Pass Rate、Pass@k、排名、混合总分、Solo 对照、角色消融或统计声明。

`DCP-001@1.0.0` 已保留为 `incomplete`：首个 accepted Trial 暴露了 Runner 对含 `undefined` 的内存
Environment object 与持久化 JSON artifact 计算出不同 digest 的 evaluator 缺陷。该版本未被覆盖或继续
执行；修复通过后以 `1.0.1` 新身份重新冻结，不选择或复用 `1.0.0` 的 Trial 结果。

## 真实 Portfolio 结果

`DCP-001@1.0.1` 的八个固定 slot 均为 `valid`、`complete`，并通过 Bundle、配置、Fingerprint、
non-leakage 与最终 Completion 独立重验。公开投影只发布冻结 schema 允许的字段：

| Case | Repeat 1 | Repeat 2 | Stability | Formal promotion eligible |
|---|---|---|---|---|
| `DC-001` | fail | pass | `investigation_required` | no |
| `DC-002` | fail | fail | `stable_fail` | yes |
| `DC-003` | fail | fail | `stable_fail` | yes |
| `DC-004` | fail | fail | `stable_fail` | yes |

这是 outcome-only 诊断结果，不是 Pass Rate、Pass@k、团队排名、统计显著性或单/多 Agent 比较。
`formalPromotionEligible` 只表示两次 canonical Hard Outcome Fingerprint 稳定，不表示 Case 或团队通过。
可观察 artifact scan 为 `no_observed_leak`，但不构成 ADR-0094 Formal Isolation 声明。

## Semantic Review 边界

八个真实 Trial 的 Layer 5 固定为 `unavailable`，原因是当前没有仓库外、版本可识别且
`tool_disabled_external_sandbox` 的真实 Judge provider。仓库 fixture 只继续验证 ADR-0098 协议，
不得附到真实 Trial 冒充 LLM 结果。未来真实 Judge 只能追加独立 Revision，不能改变 Hard Outcome、
Hard Outcome Fingerprint 或 Case Stability。

## 明确不在范围

- 完成 ADR-0094 的 Formal Isolation 实证或发布 Formal Pass Rate；
- 根据当前团队是否通过选择、替换或降低 Case 难度；
- 用私有 must-have information、窄预算或机械参与门禁强迫协作；
- LLM Judge 决定资格或 correctness/collaboration 综合得分；
- 比较 Team Configuration、模型、角色或单/多 Agent；
- 根据结果自动调 Prompt、身份、模型、权限、Tool 或 Case。

## 完成定义

v0.36 只有在以下事实全部成立时才可标记 `implementation_status: complete`：

1. Case v3、Challenge admission、Hermetic verification、non-leakage 与 v2 compatibility 自动化通过；
2. Portfolio Definition、Ledger、recovery、Fingerprint、Completion 与 public projection 自动化通过；
3. 四个私有 Case 全部 admission，reference、initial、public/withheld mapping 和 Mutants 可重复；
4. 八个固定 Trial 都形成 valid、complete、bundle-verified、non-leaking 证据；
5. 每个 Case 形成 `stable_pass`、`stable_fail` 或 `investigation_required`；
6. 全仓库测试、typecheck、Core tests、clippy、formatting 和 macOS desktop build 通过。

团队无需取得指定 Hard Pass 或 Judge verdict。任何 `incomplete`、不可恢复证据缺口、可观察配置漂移
或私有材料泄漏都会阻止版本完成；`investigation_required` 是合法诊断完成态，但该 Case 不能晋升
后续 Formal Qualification Suite。
