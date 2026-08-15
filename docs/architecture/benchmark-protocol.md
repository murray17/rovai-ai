---
document_type: architecture
authority: benchmark-protocol-components-and-boundaries
status: accepted
last_updated: 2026-08-15
---

# Benchmark Protocol 架构

Benchmark 设施位于产品 Core 之外，组织既有 Qualification evidence、确定性产品回归和显式人工触发的
私有模型 Trial。Core 继续拥有产品领域和执行事实；Benchmark 不成为 Trial、Case、Verifier、Judge、
Pass Rate 或排行榜的业务真源。

## 组件

1. `protocol/` 拥有 canonical JSON、v3 Writer/Validator、Product Contract Fingerprint 和执行兼容信封；
2. `adapters/` 识别历史 Suite/Portfolio/Trial 或 v3，未知 major fail closed；
3. `profiles/` 冻结 Lane、Suite composition、Hard Outcome 定义、发布策略和 Case evidence 引用；
4. `execution/` 从 Profile 生成 planned slots、调用 runner、聚合 raw repeat outcomes；
5. `evaluation/` 独立计算五轴比较资格和失败 taxonomy；
6. `reporting/` 从文件权威源生成 JSON/Markdown/Project 投影，并可选创建 Rovai Review Camp。
7. Qualification Layer 5 的 Judge View Module 从一个 allowlist source Pack 投影 Process 与 Blinded Outcome 两个
   Model-Visible Pack，并在 adapter 之外保留 local-to-authoritative Evidence Map。
8. Trial Measurement Module 从 Core-authoritative Canonical Operation Evidence 和预注册 Opportunity 构建可重放的
   Camp/Memory/A2A Tool Interaction，不让 observed call volume 生成 measurement denominator；
9. 独立 Tool-Use Judge Module 只评估选择必要性、输入策略、结果解释、后续使用与 Memory retention quality，
   不加入 `process | outcome` View 闭集；
10. Resource Measurement Module 以 typed unit/direction/interval/aggregation/clock/authority/coverage 保存资源向量；
11. Paired Counterfactual Module 从一个 pre-dispatch Definition 计划 fresh Team/Solo arms，并在 outcome/quality gate 后
    才计算 compatible resource deltas。

旧 `qualification:suite` 和 `qualification:project` CLI 只保留薄 wrapper。v0.34 的严格 3×4 规则位于
legacy adapter/profile，通用 Suite 不知道历史 Case ID 或固定矩阵。

## Lane

- Contract Conformance：完全确定性、默认离线，不调用模型；
- Team Qualification：保留 v0.34 Hard Outcome、Formal Isolation 和人工私有触发边界；
- Diagnostic：描述 outcome/stability 和限制，不发布正式 Qualification rate。

Lane 之间不共用排行榜，不产生 correctness/collaboration/performance 混合总分，也不以 Pass@k 隐藏原始重复。

## Semantic Judge views

Process Judge 是 Team-only View。它可见伪名化角色、Public A2A message content、确定性 interaction lifecycle，
以及判断 contribution/feedback/integration 所需的有界 delivery evidence；调用量和 Member 数只是事实，不是质量。
Public A2A content 按 Message identity 去重，fanout 只增加 interaction observation；消息 artifact 精确绑定 Message、
Delivery、Evidence Index 与 Collaboration Ledger。只有 complete source coverage 证明零 interaction 时 Process View 才
为 not applicable；证据缺失为 unavailable，两种情况都不调用模型。

Blinded Outcome Judge 对 Team/Solo 使用同一个 Interface，只可见 disclosed requirements、bounded delivered code、
workspace/verification facts 与 final response。Pack construction 在 adapter 前删除 treatment、Member、role、Call、
message、Run、Trial 和真实 Evidence identity；不能依靠 prompt 要求模型“忽略”这些字段。
预注册 treatment canary 若出现在 exact delivery content 中，Pack 在调用前 fail closed；结构盲化不冒充对任意自然语言
self-disclosure 的完美检测。

每个 View 的 Adapter 只收到 Model-Visible Pack，真实 Evidence Reference Map 留在 audit artifact。两个 Replica 使用
同一冻结 snapshot、A/B 反向 checklist order、exact item closure；disagreement 原样保留。Process 与 Outcome 不形成
综合分，也不影响 Hard Outcome。该结构隔离过程构念和结果构念，但 Team/Solo 因果价值仍须由独立 paired
counterfactual protocol 证明。

## Tool-use 与 paired counterfactual

Tool-use measurement 由 Case 预注册的 Opportunity 驱动。v2 Pack 还必须冻结并核对 Core Built-in catalog digest、
contract/IPC version 与 operation projection version；任何漂移都在 dispatch 前 fail closed。Core 只投影
operation-specific、digest-bound、长度有界的 canonical input/result；Runner 以 sealed oracle 确定性判断实体、
revision、cursor、Task state、Memory exact readback、receipt/effect 与 coverage。原始 Tool
payload、secret、完整 transcript 和 oracle answer 不进入模型。Camp message send 的 mechanical integrity 可进入 Tool
Interaction，但 delegation/handoff/contribution/feedback/integration 仍由 Process Judge判断，避免同一构念被两套 Judge
重复评估。

当前闭合 Adapter 包含 Camp/history retrieval、Memory v3 view/search/read/write、Task create/get/update/list 与 A2A send。
Memory applied receipt 只证明写入；只有预注册 readback 且同一 Memory/Revision/body digest 被权威 read/view 返回时，
才证明 immediate effective state。跨 Turn 的自动注入与行为改变仍要求多阶段或 paired Case。Process View 可见
source-bound reply parent 与 Task linkage，但这两类时序关系不能升级为贡献因果。

Tool-Use Judge 是独立 advisory review，复用双 Replica、reverse order、tool-disabled、local Evidence closure 和
non-interference 不变量，但只见 treatment-blind allowlist。它不重判 Tool 是否执行成功，也不生成 Tool score。

Paired experiment 的 Team/Solo arms 各自拥有 fresh Core/Camp/Workspace/Memory/Conversation/Native Session。Definition
冻结唯一 treatment diff、Case/fixture/request/verifier、lead runtime/model/permission、Tool availability、预算、arm order、
holdout 与 estimand。Comparison 先按 Hard Outcome 分层，再使用 blinded Outcome non-inferiority；只有 both-pass 且资源
descriptor/authority/coverage compatible 时才发布 per-metric delta/ratio。Process/Tool-Use 只解释机制，faster failure
不会成为效率收益。

## Authority flow

```text
Profile + source artifacts
  -> Adapter Registry / strict Normalizer
  -> Profile-driven planned slots and execution
  -> Benchmark Protocol v3 Run + artifact index
  -> Opportunity-bound Tool Interaction + typed Resource Measurement
  -> Process / Blinded Outcome Model-Visible Packs
  -> independent Tool-Use Model-Visible Pack
  -> dual-replica per-view reconciliation
  -> pre-registered Team/Solo paired comparison
  -> per-axis comparison eligibility
  -> JSON / Markdown / Project Review projection
```

Bundle/文件始终是投影的唯一权威源。默认 Rovai 投影只创建一个用户 authored Review Camp，发送时
`execution=null`；创建后必须验证 `CampTurn=0`、`AgentRun=0`。逐 Trial Camp 只作为显式
`--legacy-trial-camps` 兼容模式，不把 Benchmark 结果写成 Agent 自称消息。

## Public/private boundary

私有 Pack locator、Prompt、reference answer、withheld verifier、用户路径、Runtime private root、SQLite 和
凭据不进入 public v3。Project 下 `reports/<run-id>/` 保存派生 Review 与 machine JSON；这些文件不反向覆盖
历史 Bundle。Formal model Trial 仍需要专用隔离环境和人工触发，默认 CI 只运行确定性 Node/Rust evidence。

## References

- [Benchmark Protocol v3](../contracts/benchmark-protocol-v3.md)
- [Semantic Judge Views v1](../contracts/semantic-judge-views-v1.md)
- [Tool Interaction Measurement v2](../contracts/tool-interaction-measurement-v2.md)
- [Paired Collaboration Experiment v1](../contracts/paired-collaboration-experiment-v1.md)
- [ADR-0171](../adr/0171-opportunity-based-tool-interaction-measurement.md)
- [ADR-0172](../adr/0172-paired-collaboration-value-and-outcome-conditioned-efficiency.md)
- [ADR-0155](../adr/0155-treatment-blind-outcome-and-process-judge-views.md)
- [ADR-0151](../adr/0151-versioned-benchmark-protocol-and-axis-comparability.md)
- [ADR-0095](../adr/0095-layered-qualification-authority-and-semantic-review.md)
- [ADR-0097](../adr/0097-authority-preserving-benchmark-evidence-ledgers.md)
