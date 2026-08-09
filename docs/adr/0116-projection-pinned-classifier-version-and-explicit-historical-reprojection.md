---
document_type: adr
id: ADR-0116
title: Projection-Pinned Classifier Version and Explicit Historical Reprojection
status: accepted
date: 2026-08-05
decision_scope: cross-version
source_version: v0.41
supersedes: []
superseded_by: null
---

# ADR-0116: Projection-Pinned Classifier Version and Explicit Historical Reprojection

## Context

v0.41 需要允许分类规则持续修正，同时保证一个操作的身份和历史展示不会因新规则而漂移。
`operationId` 标识观测操作；`classifierVersion` 描述如何解释该操作的 Evidence。这两个
概念必须分开。

## Decision

### 1. 版本固定在默认 Canonical Projection

一个 operation 首次建立其默认 Canonical Runtime Activity Projection 时，Core 固定当时的
`classifierVersion` / contract version。该版本在同一 operation 的 started、progress、terminal
生命周期内保持不变，并用于默认历史读取。

`classifierVersion` 不是 `operationId` 的组成部分，不改变 operation identity，也不允许
因为分类器升级而把同一 operation 拆成新的 operation。

### 2. 分类升级生成显式平行 Projection

新分类器可以针对旧 Evidence replay，生成带新版本的 parallel reprojection。旧 Evidence 和
默认 Projection 保留；Renderer、Read Side 或迁移工具必须明确标示所使用的 Projection version。
新投影不能静默替换用户已经看到的默认历史。

### 3. Live operation 不中途换 classifier

一个尚未 terminal 的 operation 继续使用其默认 Projection 的固定 classifierVersion。若规则
在其执行期间升级，升级只影响后续 operation 或显式 replay，不改变当前卡片的语义。

### 4. 显式迁移必须可追溯、可回滚

若产品未来要把某个新 Projection 设为默认，必须有版本化 migration、输入 Evidence digest、
旧/新投影对照、审计记录和回滚边界。没有这些证据时，旧 Projection 继续是默认。

## Consequences

- operation identity、分类规则和历史呈现可以独立演进；
- 需要保存 Projection version、classifier digest 和 replay provenance；
- Read Side 必须定义默认版本与显式版本查询的接口边界；
- 分类修复不会自动改变用户已审阅的历史，但可能暂时保留多个并行解释。

## Rejected Alternatives

- 把 classifierVersion 拼进 operationId；
- 新分类器上线后静默重写所有历史卡片；
- 在一个 operation 生命周期中按最新规则动态换分类器；
- 丢弃旧 Projection，只保留新分类结果。

## References

- [ADR-0111: Core-Owned Canonical Runtime Activity and Observation-Honest Lifecycle Projection](0111-core-owned-canonical-runtime-activity.md)
- [ADR-0112: Immutable Execution Evidence and Rebuildable Versioned Canonical Activity Projection](0112-immutable-execution-evidence-and-rebuildable-canonical-activity-projection.md)
- [ADR-0113: Core-Scoped Operation Identity and Evidence Deduplication Boundary](0113-core-scoped-operation-identity-and-evidence-deduplication-boundary.md)
- [ADR-0114: Stable Activity Domain and Evidence-Bounded Semantic Kind](0114-stable-activity-domain-and-evidence-bounded-semantic-kind.md)
- [ADR-0115: Evidence-Bounded Activity Phase and Outcome Resolution](0115-evidence-bounded-activity-phase-and-outcome-resolution.md)
- [ADR-0117: Observation-Capability Coverage Levels Across Runtime Adapters](0117-observation-capability-coverage-levels-across-runtime-adapters.md)
- [ADR-0118: v0.41 Local Data Clean Break and Managed Reset Boundary](0118-v041-local-data-clean-break-and-managed-reset-boundary.md)
- [ADR-0119: Append-Only Versioned Evidence-to-Operation Identity Bindings](0119-versioned-evidence-to-operation-identity-bindings.md)
