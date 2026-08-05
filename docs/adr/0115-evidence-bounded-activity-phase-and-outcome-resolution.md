---
document_type: adr
id: ADR-0115
title: Evidence-Bounded Activity Phase and Outcome Resolution
status: accepted
date: 2026-08-05
decision_scope: cross-version
source_version: v0.41
supersedes: []
superseded_by: null
---

# ADR-0115: Evidence-Bounded Activity Phase and Outcome Resolution

Runtime 事件的生命周期位置和操作结果经常以不同事件、不同字段甚至不同可靠性到达。若把
`completed` 当作结果，或让 Run 终态覆盖子操作，就会把取消、失败和效果未知混成同一个状态。

## Decision

### 1. Phase 与 Outcome 分离

Canonical Activity 的 `phase` 只表示观测到的生命周期位置：started、progress 或 terminal。
`outcome` 单独表示证据边界内的结果。waiting 是非终态状态，不改变“尚未有终端结果”的事实。

### 2. 结果解析边界

- 明确非零 exit code、结构化 error 或 Runtime failed → `failed`；
- 明确 declined/denied 且 Core 证明没有执行 → `denied`；
- 明确 success 且 effect disposition 一致 → `succeeded`；
- Core 证明尚未 dispatch → `cancelled` / `not_executed`；
- dispatch 可能已开始但没有权威终端回执 → `unsettled`；
- 证据不足或无法解决冲突 → `unknown`，必要时同时保留 `unsettled` 的效果待确认标记。

`unsettled` 不是失败、成功或普通用户取消的同义词；它明确表示外部效果仍可能发生。

### 3. 冲突、乱序与 Run 终态

冲突终端 Evidence 全部保留，Projection 不采用最后到达事件覆盖先前事实，而是确定性地
投影为 `unknown` / `unsettled` 并记录冲突来源。Run 终态本身不能为未闭合的子操作补造
`completed`；子操作必须依据自身 Evidence 和 dispatch 边界决定 cancelled、unsettled 或
unknown。

### 4. Live 与 Recovery 使用同一规则

结果解析、终态优先级、缺失 start/terminal、重复和乱序处理必须是 Core/Read Side 共享的
纯规则，并以合同版本记录。Renderer 只本地化已解析的 phase/outcome。

## Consequences

- 用户可以区分“没有执行”“执行失败”和“结果待确认”；
- 取消后的潜在外部效果不会被 UI 假装成安全失败；
- Adapter 必须提供足够的 dispatch/terminal 证据，否则会产生更多 unsettled/unknown；
- 需要 fixture 覆盖冲突终端、缺失 start、Run 取消和恢复重放。

## Rejected alternatives

- 只按事件名把 `activity.completed` 显示为成功；
- Run 失败/取消时为所有子操作批量补造失败/完成；
- 采用最后到达终端事件覆盖冲突事实；
- 把 dispatch 可能已开始的取消显示为普通 `cancelled` 或 `failed`。

## References

- [ADR-0111: Core-Owned Canonical Runtime Activity and Observation-Honest Lifecycle Projection](0111-core-owned-canonical-runtime-activity.md)
- [ADR-0112: Immutable Execution Evidence and Rebuildable Versioned Canonical Activity Projection](0112-immutable-execution-evidence-and-rebuildable-canonical-activity-projection.md)
- [ADR-0113: Core-Scoped Operation Identity and Evidence Deduplication Boundary](0113-core-scoped-operation-identity-and-evidence-deduplication-boundary.md)
- [ADR-0114: Stable Activity Domain and Evidence-Bounded Semantic Kind](0114-stable-activity-domain-and-evidence-bounded-semantic-kind.md)
- [ADR-0116: Projection-Pinned Classifier Version and Explicit Historical Reprojection](0116-projection-pinned-classifier-version-and-explicit-historical-reprojection.md)
