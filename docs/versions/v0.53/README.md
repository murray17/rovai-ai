---
document_type: version-overview
version: v0.53
lifecycle: current
authority: version-scope-and-status
design_status: complete
implementation_status: complete
last_updated: 2026-08-10
---

# Rovai-ai v0.53：Versioned Benchmark Protocol v3 与 Current-Contract Regression

> 当前状态：设计、实施和全量门禁验证完成。该版本把历史 Qualification/Diagnostic 设施接入
> 版本化、Profile 驱动、按轴判断比较资格的 Benchmark Protocol v3，并新增完全离线的 v0.52 当前合同回归。
>
> 前置版本：[v0.52 Dynamic Context 精确恢复与有界 Evidence](../v0.52/README.md)

## 版本目标

每个新 Benchmark Run 都必须明确 Protocol、Profile/Suite/Case/Verifier identity、被测 Rovai 产品合同、
Execution Environment、五层 Evidence、逐轴 comparison eligibility、failure taxonomy 和 artifact integrity。
v0.31/v0.32/v0.34/v0.36 结果继续是不可变历史，不迁移、不重算、不覆盖；v3 只允许生成引用 source bytes
digest 的派生投影。

## 交付范围

- Benchmark Protocol v3 Writer/Validator、canonical content identity 和公开 disclosure gate；
- 显式 v0.32/v0.34/v0.36/v3 Adapter Registry，未知 major fail closed；
- Profile 驱动的通用 Suite、非 3×4 回归，以及严格 v0.34 legacy profile；
- Hard Outcome、Collaboration、Performance、Evidence Integrity、Contract Conformance 五轴比较；
- `current-contract-conformance@1.0.0`，组织既有 Rust 测试覆盖 v0.52 的 15 项发布合同；
- 五个公开、可执行的 Demo Case（`DEMO-001` 至 `DEMO-005`），覆盖事件、归一化、幂等、迁移和受限 patch；
- JSON/Markdown/baseline diff/failure taxonomy/Project Review projection；
- 旧 `qualification:*` 命令继续可用，新 `benchmark:*` 命令提供 v3 工作流。

## 冻结边界

- v0.34 Hard Outcome 公式不变；Validity/Evaluation State 缺证据仍是 invalid/pending，不伪造 fail；
- Semantic Judge 不创造、阻止、提升或降低 Hard Outcome；
- Contract Conformance、Team Qualification、Diagnostic 是不同 Lane；
- 不生成 correctness/collaboration/performance 混合总分、Pass@k 或跨不可比配置排行榜；
- Trial、Case、Verifier、Judge 和 rate 不进入 Rust Core；
- 默认 CI 不调用付费模型、真实 Runtime 账户、私有 Sealed Pack 或用户数据目录；
- 正式模型 Trial 仍需要人工、私有、专用隔离触发。

## Product Contract Fingerprint

当前采集直接读取 Git/build metadata 和 Rust 代码常量：Data Contract v0.52/schema 28、CampSnapshot 27、
ContextManifest 9、Context Formatter 11、Context Delivery Profile 2、Built-in Transport 4；Durable Task v2 与
accepted-only ACK 使用产品源代码/确定性测试 source digest。可选 Core executable bytes 提供 executable digest，
可验证 Core health 提供 canonical Built-in Catalog digest。缺少这两项时分别记录
`product.core_executable_not_supplied` 和 `product.builtin_catalog_requires_core_health`，不从文档猜值。

## Project projection

Bundle/文件是唯一权威源。默认只创建一个用户 authored Review Camp，发送 `execution=null` 并验证没有
CampTurn/AgentRun；详细 JSON/Markdown 位于 `reports/<run-id>/`。旧的一 Trial 一 Camp 行为必须显式使用
`--legacy-trial-camps`。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.52 冻结为 historical，v0.53 成为唯一 current；新增本概览、architecture 与实施计划 |
| ADR | 已更新 | ADR-0151 冻结版本化协议、历史不可变和按轴可比性 |
| Contracts | 已更新 | 新增长期 Benchmark Protocol v3 字段合同和 v0.53 JSON Schema |
| Architecture | 已更新 | 新增 Adapter/Profile/Execution/Evaluation/Reporting 长期组件边界 |
| UI | 确认无需更新 | 本版本不改变 Renderer 交互、视觉或公开 Core UI 合同 |
| Runtime Activity | 确认无需更新 | 不新增或重分类 Canonical Runtime Activity |
| Runtime compatibility | 确认无需更新 | Fingerprint 记录既有 Runtime 配置，但不改变 Runtime 支持或能力结论 |
| Documentation routing | 已更新 | 文档导航、Contract/Architecture/ADR/Version 索引加入 Benchmark Protocol 入口 |
| Root README | 确认无需更新 | 项目定位、常青产品能力和支持 Runtime 范围不变 |

## References

- [v0.53 architecture](architecture.md)
- [v0.53 实施与验收计划](implementation-plan.md)
- [ADR-0151](../../adr/0151-versioned-benchmark-protocol-and-axis-comparability.md)
- [Benchmark Protocol v3](../../contracts/benchmark-protocol-v3.md)
- [Benchmark Protocol architecture](../../architecture/benchmark-protocol.md)
- [公开 Demo Case 目录](../../../qualification/demo/README.md)
