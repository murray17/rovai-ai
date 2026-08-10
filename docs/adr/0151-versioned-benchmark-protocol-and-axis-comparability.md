---
document_type: adr
id: ADR-0151
title: Versioned Benchmark Protocol and Axis-Scoped Comparability
status: accepted
date: 2026-08-10
decision_scope: cross-version
source_version: v0.53
supersedes: []
superseded_by: null
---

# ADR-0151: Versioned Benchmark Protocol and Axis-Scoped Comparability

## Context

Qualification Runner 0.36.0、Suite v0.34 和 Trial/Suite schema v2 能生成权威的五层证据，但历史 project
脚本把 v0.32/v0.34 schema 分支、3×4 矩阵、Case ID、聚合、Markdown、文件写入和 Camp import 耦合在
一起。结果没有统一记录被测产品合同，也不能判断不同 Case Seal、Team、Runtime、模型、权限或 Evidence
协议之间是否可比较。一个全局 comparable Boolean 会继续掩盖某些轴可比、另一些轴不可比的事实。

## Decision

引入 Benchmark Protocol v3 和显式 Adapter Registry。v3 Writer 只写 v3；未知 major fail closed。
v0.32 Suite、v0.34 Suite、v0.36 Diagnostic Portfolio 保持不可变，由各自 adapter 读取。历史 artifact 不
原地迁移或重算；需要统一查看时只能生成携带精确 source artifact digest 的 derived v3 projection。

Suite 的 round、case、slot 和 publication policy 全部由 Profile 定义。Legacy v0.34 adapter 单独严格验证
`suite.version=v0.34`、3 rounds 和 4 cases；通用执行和报告不认识历史 Case ID 或固定矩阵。

每个 v3 Run 同时固定 Benchmark Protocol、Profile/Suite/Case/Verifier identity、Product Contract
Fingerprint、Execution Environment compatibility envelope、Hard Outcome、五层 Evidence 引用、artifact
index、disclosure 与 integrity。Product Contract 字段只允许来自代码常量、build metadata、Git、Core health、
executable bytes 或既有 qualification evidence；取不到时写 unavailable 和结构化 reason，禁止从 Markdown
推断。原 `teamRuntimeCompatibilityDigest` 必须保留并进入更完整兼容信封。

比较必须分别计算 Hard Outcome、Collaboration、Performance、Evidence Integrity、Contract Conformance
五轴资格。Case Seal、Verification Catalog、Change Boundary、Budget、Team、Transport、Runtime/模型/权限、
平台或 Evidence schema 变化产生稳定 reason code。不可比轴仍可显示原值，但抑制 delta。

Contract Conformance、Team Qualification、Diagnostic 是独立 Lane，不形成跨 Lane 排行榜或混合总分。
ADR-0095 的 Hard Outcome 和 Judge 边界保持：Judge 只顾问，不改变资格；raw repeats 不替换为 Pass@k。
Benchmark 代码不进入 Rust Core 成为业务真源。

Project projection 以 Bundle/文件为唯一权威，默认只创建一个 `execution=null` 的用户 authored Review Camp，
并验证没有 CampTurn/AgentRun。逐 Trial Camp 只保留为显式 legacy 模式。

## Consequences

未来 Profile 可以使用非 3×4 Suite，而无需修改 generic runner。跨版本报告能明确解释某一轴为什么不可比，
避免把模型、权限或平台漂移误报为产品回归。公开输出会主动拒绝路径、凭据和密封材料泄漏。

真实模型 Team Qualification 仍需要人工、私有、专用隔离触发，不能进入默认 CI。没有 Core executable 或
Core health evidence 的离线运行会将 executable/Catalog digest 记录为 unavailable；这降低对应比较轴资格，
但不会伪造值或使确定性合同测试失去结果。

## Rejected Alternatives

- 原地把历史 JSON 改写为 v3 被拒绝，因为会破坏历史不可变性和原始签名/摘要。
- 一个全局 comparable Boolean 被拒绝，因为 Team drift 不必然阻止 Evidence schema 比较，反之亦然。
- 把版本写死在 Markdown 或 benchmark 代码中被拒绝，因为文档不是运行时产品身份权威。
- 继续在 project/suite CLI 中保留矩阵与 schema 分支被拒绝，因为会让下一 Profile 再次复制执行管线。
- 让 Judge 或 composite score 补偿硬失败被拒绝，因为违反 ADR-0095。

## References

- [v0.53 overview](../versions/v0.53/README.md)
- [Benchmark Protocol v3](../contracts/benchmark-protocol-v3.md)
- [Benchmark Protocol architecture](../architecture/benchmark-protocol.md)
- [ADR-0095](0095-layered-qualification-authority-and-semantic-review.md)
- [ADR-0102](0102-immutable-diagnostic-portfolio-authority.md)
