---
document_type: architecture
authority: benchmark-protocol-components-and-boundaries
status: accepted
last_updated: 2026-08-10
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

旧 `qualification:suite` 和 `qualification:project` CLI 只保留薄 wrapper。v0.34 的严格 3×4 规则位于
legacy adapter/profile，通用 Suite 不知道历史 Case ID 或固定矩阵。

## Lane

- Contract Conformance：完全确定性、默认离线，不调用模型；
- Team Qualification：保留 v0.34 Hard Outcome、Formal Isolation 和人工私有触发边界；
- Diagnostic：描述 outcome/stability 和限制，不发布正式 Qualification rate。

Lane 之间不共用排行榜，不产生 correctness/collaboration/performance 混合总分，也不以 Pass@k 隐藏原始重复。

## Authority flow

```text
Profile + source artifacts
  -> Adapter Registry / strict Normalizer
  -> Profile-driven planned slots and execution
  -> Benchmark Protocol v3 Run + artifact index
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
- [ADR-0151](../adr/0151-versioned-benchmark-protocol-and-axis-comparability.md)
- [ADR-0095](../adr/0095-layered-qualification-authority-and-semantic-review.md)
- [ADR-0097](../adr/0097-authority-preserving-benchmark-evidence-ledgers.md)
