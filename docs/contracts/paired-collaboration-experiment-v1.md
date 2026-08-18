---
document_type: interface-contract
contract: paired-collaboration-experiment
version: 1
authority: paired-team-solo-collaboration-value-and-resource-comparison
status: accepted
last_updated: 2026-08-13
---

# Paired Collaboration Experiment v1

本合同冻结 Team/Solo counterfactual definition、arm planning、typed resources 和 outcome-conditioned comparison。
它不改变独立 Qualification Trial、Benchmark Protocol v3 的跨版本五轴比较或 Hard Outcome。

## Definition 与 arm planning

`rovai.benchmark.paired-trial-definition@1.0.0` 必须在任何 arm dispatch 前冻结：

- experiment ID/version、estimand、development/holdout partition 和 replicate count；
- Case ID/version/seal、Tool Measurement Spec/Fixture/Oracle digests 和 verifier identity；
- request、workspace fixture、budget、lead model/runtime/permissions、ordinary Tool availability 与 isolation profile；
- Team/Solo 的 exact treatment declaration、唯一允许的 treatment difference keys；
- fresh-state keys：Core data、Camp、Workspace、Memory、Conversation、Native Session；
- resource profile、Outcome/Tool-Use Judge configuration、blinding canaries；
- deterministic seeded counterbalanced arm-order policy、exclusion/invalidity 与 non-inferiority rule。

`planPairedTrials` 只从 frozen seed 和 replicate index 生成 arm order；不得根据早期结果选择顺序、替换 arm 或追加选择性
repeat。每个 arm 有 stable plan ID、treatment、fresh Trial ID 和 peer binding。shared Core/Camp/Memory/Workspace 或
pre-dispatch assignment 缺失使 pair invalid。

v1 treatment 闭合为 `team: {coordinationMode: multi_agent}` 与
`solo: {coordinationMode: single_agent}`，唯一允许差异键为 `coordinationMode`；模型、Runtime、权限、ordinary Tool
availability 或预算差异均使 pair invalid。CLI 在 dispatch 前以 admitted Case Seal、Tool Measurement Pack、verifier、prompt、
fixture 与 budget 重算 Definition binding；arm 完成后再从已通过 Bundle replay 的 normalized Qualification Case、Verifier
Observation 和 Environment Manifest 重算 Case/verifier、Lead runtime/model/permission、Built-in Tool catalog/capability 与
isolation factors。不得把 Definition 声明直接复制成 observed arm evidence。

每个 actual arm 必须回填 exact plan digest、pair slot、arm plan ID、Trial ID、dispatch ordinal 与其 Evidence Reference；
Hard Outcome、fresh-state identities 和 Resource Measurement 也分别绑定 retained artifact。plan 漂移、arm swap、复用 fresh
identity、缺失 evidence 或 blinding canary/configuration drift 均 fail closed，不进入 paired causal denominator。

## Resource Measurement Profile

`rovai.benchmark.resource-measurement-profile@1.0.0` 的每个 metric descriptor 必须包含：

```json
{
  "id": "makespan_ms",
  "unit": "milliseconds",
  "direction": "lower_is_better | higher_is_better | descriptive",
  "interval": "dispatch_to_terminal",
  "aggregation": "elapsed | union | sum | maximum | longest_path | receipt_total",
  "clockDomain": "runner_monotonic | core_persisted_wall_clock | provider_receipt",
  "authority": "runner | core | provider",
  "coverage": "complete_required | partial_allowed"
}
```

默认 profile 可包含 `makespan_ms`、`agent_active_union_ms`、`agent_active_sum_ms`、`max_agent_concurrency`、
`coordination_wait_ms`、`critical_path_ms`、`input_tokens`、`output_tokens`、`total_tokens`、`cost_usd_micros`。
每个 measurement 保留 exact descriptor、status、value、coverage reason 与 Evidence References。

规则：

- makespan 只使用同一 runner monotonic dispatch-to-terminal interval；ISO wall timestamps 不能冒充 monotonic elapsed；
- union 合并重叠 AgentRun intervals，sum 明示并行 double-count，二者不得混用；
- coordination wait/critical path 需要完整 parent/delivery/run dependency coverage；
- token/cost 只接受 provider-authoritative receipt；provider 不暴露时为 unavailable，禁止估算或填零；
- metric descriptor/clock/unit/interval/aggregation/authority 不同则 paired comparison incompatible。

## Comparison

`comparePairedTrial` 先验证 Definition binding、fresh state、Case/verifier/Tool spec、common factors、treatment-only diff、
arm completion、Hard Outcome 和可选 blinded Outcome quality。输出
`rovai.benchmark.paired-comparison@1.0.0`，outcome stratum 闭集：

- `both_pass`
- `team_only_pass`
- `solo_only_pass`
- `both_fail`
- `indeterminate`

只有 `both_pass` 且 blinded Outcome quality 为 Team non-inferior/equivalent、Outcome Judge configuration 与预注册 treatment
blinding canary 都闭合，并且相同 metric 在两臂均 complete、authoritative、
descriptor-compatible 时，才发布该 metric 的 `{team, solo, delta, ratio}`。其他情况为 `comparison:null` 与 stable reason；
Team/Solo-only pass 报 outcome difference 与 descriptive resources，both-fail 不发布效率，避免奖励更快失败。

可选解释 classification 只允许 `dominant | quality_gain_with_cost | efficiency_gain | dominated | tradeoff | tie |
inconclusive`，必须由 outcome/quality/resource vector 的显式规则派生；它不是分数、排名或跨 Case winner。每个 raw pair、
invalid/excluded pair、Judge disagreement、coverage gap 和 order 都保留；不得只发布成功 pair。

## Claim levels

- 单 pair：diagnostic counterfactual observation；
- 多个预注册、有效、同构 pair：可报告 raw paired deltas 与不确定性；
- unseen holdout + blinded scoring：可支持对冻结 Case population 的有限 generalization；
- dedicated Formal isolation、充分样本和预注册统计分析：才可发布 causal collaboration claim。

任一级别都不证明 general intelligence、任意角色的独立因果贡献或跨模型排行榜。Role/Tool ablation 是新的 treatment，必须
另行预注册。

## References

- [ADR-0172](../versions/v0.68/decisions.md#adr-0172)
- [Tool Interaction Measurement v1](tool-interaction-measurement-v1.md)
- [Benchmark Protocol v3](benchmark-protocol-v3.md)
- [Semantic Judge Views v1](semantic-judge-views-v1.md)
- [ADR-0094](../versions/v0.34/decisions.md#adr-0094)
