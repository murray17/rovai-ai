---
document_type: adr
id: ADR-0112
title: Immutable Execution Evidence and Rebuildable Versioned Canonical Activity Projection
status: accepted
date: 2026-08-05
decision_scope: cross-version
source_version: v0.41
supersedes: []
superseded_by: null
---

# ADR-0112: Immutable Execution Evidence and Rebuildable Versioned Canonical Activity Projection

v0.41 需要在不伪造 Runtime 内部行为的前提下持续改进跨 Runtime 分类。若把当前分类结果当作唯一事实，任何规则修正都会污染历史；若每次读取都临时猜测，实时与恢复又会漂移。因此事实权威和语义 Projection 必须分层，并且 Projection 必须可重建。

## Decision

### 1. Execution Evidence 是唯一不可变事实真源

Runtime 实际报告的事件和 Core 实际介入的事实以 append-only Execution Evidence 保存。Evidence 的来源身份、序列、观测内容边界和脱敏结果不可因分类规则变化而修改。缺少 Evidence 不能被补写为“已执行”。

### 2. Canonical Runtime Activity 是持久且可重建的 Core Projection

Core 根据 Evidence 和经过验证的 Core Action 绑定生成 Canonical Runtime Activity，并持久保存它，供 Read Side 和恢复读取使用。每个 Projection 必须引用其来源 Evidence，并记录 classifier/contract/projection version。持久化不是新的事实真源：给定相同 Evidence、绑定输入和版本规则，Projection 必须能够被确定性重建。

### 3. 分类升级不得静默改写历史

分类规则升级生成新的 Canonical Projection/version；旧 Evidence 和原始 Projection 版本保留。默认历史读取保持 Projection 首次建立时固定的观察版本。`classifierVersion` 属于默认 Canonical Projection，不属于也不改变 `operationId`。任何重投影、比较或迁移必须带有显式版本标识、可追溯输入和回放结果，不能把新分类悄悄覆盖到用户已经看到的历史活动上。

### 4. Lifecycle Projection 依赖版本化 Canonical Activity

Lifecycle Projection 对同一 `operationId` 的 started/progress/terminal 事实执行确定性合并。它可以是进一步的 Read Side 派生层，但不能删除或重写 Evidence/Canonical Activity；live 和 recovery 必须使用同一版本化输入与规则。

## Consequences

- Runtime mapping 可以独立迭代，历史证据仍可审计和重放；
- 需要为 Projection 保存版本、来源引用和重建失败状态；v0.41 内部重投影不能只改一列枚举，也不能借此引入旧版本本地数据兼容；
- Read Side 需要明确默认历史版本和显式重投影入口；
- Fixture、replay、mapping registry 和 classifier 版本成为每次语义变更的必需交付物。

## Rejected alternatives

- 把 Canonical Activity 当成不可追溯的唯一事实表，直接覆盖旧分类；
- 每次 Renderer 读取时从标题、命令或 Runtime 名称即时猜测分类；
- 只保存 Evidence、完全依赖无版本的临时重算，导致实时/恢复和历史展示无法稳定复现；
- 从工作区 diff 或最终回复推导并持久化未报告的内部步骤。

## References

- [ADR-0111: Core-Owned Canonical Runtime Activity and Observation-Honest Lifecycle Projection](0111-core-owned-canonical-runtime-activity.md)
- [ADR-0113: Core-Scoped Operation Identity and Evidence Deduplication Boundary](0113-core-scoped-operation-identity-and-evidence-deduplication-boundary.md)
- [ADR-0116: Projection-Pinned Classifier Version and Explicit Historical Reprojection](0116-projection-pinned-classifier-version-and-explicit-historical-reprojection.md)
- [ADR-0118: v0.41 Local Data Clean Break and Managed Reset Boundary](0118-v041-local-data-clean-break-and-managed-reset-boundary.md)
- [ADR-0059: Runtime-Owned Resource Permissions](0059-runtime-owned-resource-permissions.md)
- [ADR-0061: Durable User-Visible and Agent-Inaccessible Execution Evidence](0061-durable-agent-inaccessible-execution-evidence.md)
