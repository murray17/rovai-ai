---
document_type: version-overview
version: v0.86
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-16
---

# Rovai-ai v0.86：Benchmark Tool-use Measurement v2

> 当前状态：评测框架已完成，并已 rebase 到 Built-in Tool Transport v12/十四项 catalog；
> 本版本只准备评测能力，不把尚未执行的真实模型 Trial 写成通过结论。
>
> 前置版本：[v0.85 Agent 主导的伙伴入队](../v0.85/README.md)
>
> 后继版本：[v0.87 TRAE 静态检测与执行期验证](../v0.87/README.md)

## 版本目标

让即将执行的 Benchmark 能诚实评测当前 Built-in Tool surface，而不是继续依赖 v0.68 时的旧 operation 假设。
重点覆盖 Camp/history retrieval、Memory v3 的读取/写入/readback、Durable Task coordination，以及 A2A 的
reply/Task/时序证据；继续维持“确定性事实归 deterministic layer，语义判断归 LLM Judge”的权威分工。

本版本不增加综合 Tool score 或 collaboration score。Tool-use 逐 Opportunity 报告，Process/Outcome/Tool-Use
Judge 保持分离；Team/Solo 效果与效率仍只由 paired counterfactual protocol 证明。

## 交付范围

- Core `operationProjection@2` 与 `health.check` 暴露 projection version；当前十四项 Built-in catalog（包含
  `member.create`）每项都有 start/terminal 穷举准入门禁；
- 修复 `memory.view` 因 Evidence projection 漏接而在执行前失败的问题；Memory v3 nested Target、read/view exact
  semantic body、write/revise retention strategy 进入 secret-filtered bounded projection；
- Tool Measurement Spec/Measurement/Judge Pack 升级 v2，并在 dispatch 前精确绑定 Core catalog digest、
  contract/IPC/projection version；
- Adapter 增加 `history.search`、`memory.view` 和 Task create/get/update/list；旧或未知 operation fail closed；
- Private Fixture v2 可预置 symbolic Task，使 get/update/list 可在 sealed relevant/distractor Task 上测量；
- Evidence Index 为 Memory exact readback 与 Task final state 生成独立 Judge-safe content identity；
- Memory `requireEffectiveReadback` 区分 applied receipt 与 immediate effective state；跨 Turn 行为改变仍明确未证明；
- Collaboration Evidence 保留 Message sequence、reply parent、Task linkage；Process Judge 可评反馈语义，但不得把
  reply/task adjacency 提升为贡献因果；
- v2 Contract、schema catalog、Runner replay 和针对性回归同步升级。

## 即将评测的准备度

| 能力 | 现在可以诚实测量 | 仍不能由单次 Trial 证明 |
| --- | --- | --- |
| Camp/history | 预置 relevant/distractor Message，测 selection、query/target、exact retrieval、pagination 与 downstream candidate | 未做 availability ablation 时的净产出价值 |
| Memory retrieval | 预置 current/stale Memory，测 `view/search/read` 的 scope、identity、revision、cache 与语义吸收 | 长期自动召回或跨 Turn 行为改变 |
| Memory write | 测输入语义、scope/kind/target、receipt/revision，并可预注册 exact immediate readback | “写入后未来任务更好”，需要多阶段或 paired ablation |
| Task tools | 以 symbolic Task fixture 预置 relevant/distractor，测 create/get/update/list、version fence、assignee/status、receipt 与 final state | Task 导致成果改善的因果归因 |
| A2A | 测 exact recipients、预注册 Task link、Message/Delivery/Run/receipt；Process Judge 看 delegation/handoff/reply/feedback/integration | Team 比 Solo 更有效，或某个 Member 导致交付变化 |
| 效率 | paired Trial 在 both-pass 且 Outcome non-inferior 时发布 typed resource delta | 用 call/member 数量或失败得更快声称高效 |

实际开跑前仍需为每个 Case 生成与当前 Core health fingerprint 精确一致的 private Pack，
并分别预注册 deterministic oracle 与 applicable LLM checklist。本版本完成的是评测能力，
不是任何真实 Runtime/Model 的评测结论。

## 非目标与测量限制

- 不在本版本执行或发布真实 LLM Judge、Team/Solo paired Trial 或统计 uplift；
- 不用一次 immediate `memory.read/view` 声称长期 Memory 自动注入、召回或行为改变；这些需要多阶段 Case；
- 不把调用次数、成员数、返回条数或运行时长单独当作质量；
- 不让 LLM 判断 receipt、revision、状态、计时、coverage 或 sealed oracle 命中；
- 不修改 Hard Outcome 公式，也不让 advisory Judge 补偿失败交付；
- `member.create` 在本版本只进入 Core projection 和通用 Tool Ledger，尚未获得专用语义 Adapter；人类
  确认、六字段身份质量与新建成员后续价值应作为下一个独立 Opportunity 族，不得偷混进 Task/A2A score。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.85 冻结为 historical；本概览、[实施计划](implementation-plan.md)与[版本索引](../README.md)建立唯一 current v0.86。 |
| ADR | 确认无需更新 | 实现遵循 [ADR-0171](../../adr/0171-opportunity-based-tool-interaction-measurement.md) 的 closed Adapter/Opportunity/Judge authority，未改变长期决定。 |
| Contracts | 已更新 | [Tool Interaction Measurement v2](../../contracts/tool-interaction-measurement-v2.md)替代 v1，冻结 runtime compatibility、Memory v3/readback、Task 与 current Adapter wire。 |
| Architecture | 已更新 | [Benchmark Protocol](../../architecture/benchmark-protocol.md)记录 v2 compatibility gate、Memory effective-state 边界与 A2A reply/Task 候选关系。 |
| UI | 确认无需更新 | 本版本没有 Renderer、交互或视觉表面变化。 |
| Runtime Activity | 确认无需更新 | Runtime Activity canonical mapping 未变化；新增的是 Core-owned Qualification Evidence projection。 |
| Runtime compatibility | 确认无需更新 | 不改变 Product Runtime 能力结论；Pack 精确绑定 v12/十四项 catalog 所属 Core health fingerprint。 |
| Documentation routing | 已更新 | [文档导航](../../README.md)、[合同索引](../../contracts/README.md)与 [ADR current map](../../adr/CURRENT.md)路由到 v2。 |
| Root README | 确认无需更新 | 项目常青产品定位和公开支持范围不因 Benchmark 内部测量升级而变化。 |

## References

- [实施与验收计划](implementation-plan.md)
- [Tool Interaction Measurement v2](../../contracts/tool-interaction-measurement-v2.md)
- [Benchmark Protocol 架构](../../architecture/benchmark-protocol.md)
- [ADR-0171](../../adr/0171-opportunity-based-tool-interaction-measurement.md)
- [ADR-0172](../../adr/0172-paired-collaboration-value-and-outcome-conditioned-efficiency.md)
