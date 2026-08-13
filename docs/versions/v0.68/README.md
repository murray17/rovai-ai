---
document_type: version-overview
version: v0.68
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-13
---

# Rovai-ai v0.68：Tool-use 测量与配对协作价值实验

> 当前状态：Core Evidence、Tool Interaction、独立 Tool-Use Judge、typed Resource Measurement 和 Team/Solo paired
> protocol 已按接受的合同完成实现与离线协议验证；真实模型 Trial、Formal isolation 与统计 claim 仍未执行。
>
> 前置版本：[v0.67 当前用户注意力与渐进式 CLI 教学](../v0.67/README.md)

## 版本目标

把 Benchmark 从“Tool 被调用、A2A 成功、任务完成”推进到可验证的 Tool-use 与协作价值测量：以预注册
opportunity 而非调用量作为分母，确定性重放 Camp/Memory/A2A 的有界输入与结果，使用独立 LLM Judge 评估
必要性、查询/输入策略、结果解释与后续吸收，并以 Team/Solo 配对反事实和 outcome-conditioned resources 判断
协作是否真正创造价值。

本版本不改变 Hard Outcome 的唯一资格权威，不把更多 Agent/Call 解释为更好，不把 Process、Tool-use、Outcome
和成本混成总分，也不发布无 Formal isolation 或样本设计支撑的因果结论。

## 交付范围

### Opportunity 与证据

- 新增 `forced_use | natural_use | non_use_control` Tool Measurement Opportunity；Agent 不能通过自行调用制造分母；
- Core Execution Evidence 增加 operation-specific、长度有界且与 raw input/output digest 绑定的 Canonical
  Operation 投影，禁止 credential、raw transcript 和未界定正文；
- Current Built-in 在执行前 durable 记录 authenticated start fence，terminal 再绑定结果；只有完整分页与 start fence
  同时成立才允许 complete invocation coverage，start/terminal 不重复计数；
- Camp history retrieval、Memory retrieval、Memory mutation 与 Camp message send 使用闭合 Adapter；未知操作只保留
  generic lifecycle；
- deterministic layer 判断身份、schema、authorization、receipt/effect、result IDs/revisions、pagination、replay、
  opportunity/oracle alignment 与 coverage。

### 独立 Tool-Use Judge

- Tool-Use Judge 与现有 Process/Blinded Outcome Views 分离；A2A delegation/handoff/contribution/feedback/integration
  仍由 Process Judge 拥有；
- 模型只看到 treatment-blind allowlist、local Evidence IDs 和语义判断所需的最小 bounded projection；sealed oracle、
  deterministic verdict、真实成员/model identity 不可见；
- 双 Replica、reverse order、tool/network/workspace disabled、逐项 disagreement/abstention 与 Hard Outcome
  non-interference 保持；不生成 aggregate score。

### Paired collaboration value 与效率

- Team 与 Solo arm 使用同一 sealed Case、fixture、prompt、model/runtime/permission policy、Tool availability、预算和
  measurement profile，仅允许 treatment declaration 明示差异；每个 arm 使用全新 Core/Camp/Workspace/Memory/Session；
- paired CLI 在 dispatch 前从 admitted Case/Tool Pack 重算 binding，并在 arm 完成后从 Bundle-verified normalized artifacts
  重算实际 common factors、plan binding 与 fresh-state evidence，不接受把 Definition 声明复制为观测事实；
- 先报告 `both_pass | team_only_pass | solo_only_pass | both_fail | indeterminate`，再独立报告 blinded semantic outcome、
  Process/Tool-use mechanism evidence 与 typed resources；
- makespan、active interval、coordination wait、Tool/A2A latency、token/cost 等均声明 unit、direction、interval、
  aggregation、clock、authority 与 coverage；缺失不当零；
- 只有 outcome equivalent/non-inferior 且双臂 measure compatible 时才计算效率 delta/ratio；更快失败不获奖励；
- development/holdout、arm order、exclusion 和原始 pairs 均预注册并保留；单 pair 只作 diagnostic。

完整稳定边界由 [ADR-0171](../../adr/0171-opportunity-based-tool-interaction-measurement.md)、
[ADR-0172](../../adr/0172-paired-collaboration-value-and-outcome-conditioned-efficiency.md)、
[Tool Interaction Measurement v1](../../contracts/tool-interaction-measurement-v1.md) 和
[Paired Collaboration Experiment v1](../../contracts/paired-collaboration-experiment-v1.md) 拥有；实施证据见
[实施计划](implementation-plan.md)。

## 当前限制

- 新协议使真实测量成为可能，但仓库中的离线 fixtures 不等于已完成真实模型 Trial、Formal isolation 或统计显著性；
- provider token/cost 或 monotonic interval 无权威证据时保持 unavailable；
- coordination wait、critical path 仍要求完整 dependency coverage；普通 Final/Code 与 Tool result 只有同 Trial candidate
  关系时不得冒充 causal downstream absorption；
- Tool-use Judge 需要冻结、version-identifiable model snapshot 和独立校准集；fixture adapter 只验证协议行为；
- 本版本不处理 Skill effectiveness，也不把 Tool-use 结果提升为产品 Tool 或 Memory 行为的正确性真源。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.67 以完整实现事实冻结为 historical；v0.68 成为唯一 current，并记录新的测量范围与限制 |
| ADR | 已更新 | ADR-0171 冻结 opportunity-based Tool Interaction/独立 Tool-Use Judge；ADR-0172 冻结配对协作价值与 outcome-conditioned efficiency |
| Contracts | 已更新 | 新增 Tool Interaction Measurement v1、Paired Collaboration Experiment v1 及 cross-version schemas |
| Architecture | 已更新 | Benchmark Protocol 增加 Trial Measurement、Tool-Use Judge、Resource Measurement 与 Paired Counterfactual 模块 |
| UI | 确认无需更新 | 本版本仅改变私有 Benchmark/Qualification artifact 与 CLI，不新增 Renderer surface 或 UX 合同 |
| Runtime Activity | 确认无需更新 | Canonical Operation Evidence 是 Agent-inaccessible measurement projection，不改变 Activity classifier 或用户过程显示 |
| Runtime compatibility | 确认无需更新 | 不新增 Runtime capability；真实 Trial 仍受现有 frozen runtime/model compatibility 与 Formal isolation 约束 |
| Documentation routing | 已更新 | docs map、CURRENT、Architecture/Contract 索引和 current version pointer 路由到 v0.68 权威 |
| Root README | 确认无需更新 | 项目定位和常青产品能力不变；根 README 不记录私有 Benchmark 协议版本 |

## References

- [v0.68 实施与验收计划](implementation-plan.md)
- [ADR-0171](../../adr/0171-opportunity-based-tool-interaction-measurement.md)
- [ADR-0172](../../adr/0172-paired-collaboration-value-and-outcome-conditioned-efficiency.md)
- [Tool Interaction Measurement v1](../../contracts/tool-interaction-measurement-v1.md)
- [Paired Collaboration Experiment v1](../../contracts/paired-collaboration-experiment-v1.md)
- [Semantic Judge Views v1](../../contracts/semantic-judge-views-v1.md)
- [Benchmark Protocol 架构](../../architecture/benchmark-protocol.md)
