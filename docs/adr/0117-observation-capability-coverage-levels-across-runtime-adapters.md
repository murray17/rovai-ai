---
document_type: adr
id: ADR-0117
title: Observation-Capability Coverage Levels Across Runtime Adapters
status: accepted
date: 2026-08-05
decision_scope: cross-version
source_version: v0.41
supersedes: []
superseded_by: null
---

# ADR-0117: Observation-Capability Coverage Levels Across Runtime Adapters

## Context

九个已接入 Runtime 的协议暴露程度不同。若把“是否支持某 Runtime”和“Core 能观察到多少
活动”混成一个等级，Renderer 会被迫用推断填补协议缺口，最终制造虚假的细粒度 Evidence。

## Decision

### 1. 全部 Runtime 共用一份 Canonical 合同

所有已接入 Runtime 都必须进入同一 Canonical Runtime Activity、Lifecycle Projection 和
Renderer Presentation 合同。合同覆盖范围不因某个 Runtime 暂时只能提供 Run-level 事实而被拆成
另一套语义。

### 2. Coverage level 只描述观测能力

Mapping Registry 为每个 Adapter/协议版本登记以下 coverage level：

- `fine_grained`：协议实际报告足够的结构化操作身份、阶段和/或结果，可映射到细粒度活动；
- `run_level`：协议只可靠地报告 Run 开始、处理、终态或最终回复；
- `unknown`：能力未验证、字段冲突或无法安全归类。

Coverage level 描述 Core 实际可观察的协议事实，不代表产品支持等级、质量、权限或 Runtime
可靠性。低 coverage level 不能通过最终工作区变化、最终回复、标题、命令字符串或 provider
名称推断升级。

### 3. v0.41 的初始分层

Codex 和 ACP 六个 Runtime 在结构化事件存在且 fixture/replay 通过时提供细粒度映射；Claude
Code、Antigravity 当前注册 Run-level 映射，并保留 Core 确实介入的 Team Tool 活动。所有
Runtime 都必须诚实地呈现其 `run_level`/`unknown` 边界。

### 4. 升级必须有证据

从 `run_level` 或 `unknown` 升级到 `fine_grained` 必须新增 mapping registry 条目、稳定
operation identity 证明、正例/未知/冲突/恢复 fixture、replay 结果和必要的真实 Runtime smoke。
没有这些证据时，Adapter 保持原 coverage level。

## Consequences

- 统一合同不会要求 Runtime 伪造自己没有的内部事件；
- 用户能区分“产品支持”与“本次协议实际观察到的范围”；
- 新 Runtime 可以先安全接入 Run-level，再以证据驱动逐步细化；
- Read Side 和 Renderer 必须展示 coverage/credibility 边界，而不是隐藏缺口。

## Rejected Alternatives

- 为每个 Runtime 维护一套互不兼容的 Canonical Activity schema；
- 把 coverage level 当作产品支持评级或质量分数；
- 从 workspace diff、最终回复或 Runtime 名称补造细粒度步骤；
- 让未验证的 Adapter 自动宣称 `fine_grained`。

## References

- [ADR-0111: Core-Owned Canonical Runtime Activity and Observation-Honest Lifecycle Projection](0111-core-owned-canonical-runtime-activity.md)
- [ADR-0114: Stable Activity Domain and Evidence-Bounded Semantic Kind](0114-stable-activity-domain-and-evidence-bounded-semantic-kind.md)
- [ADR-0116: Projection-Pinned Classifier Version and Explicit Historical Reprojection](0116-projection-pinned-classifier-version-and-explicit-historical-reprojection.md)
