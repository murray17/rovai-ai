---
document_type: adr
id: ADR-0122
title: Current Canonical Activity Projection and Deferred Identity Replay
status: accepted
date: 2026-08-05
decision_scope: version-scope
source_version: v0.41
supersedes: [ADR-0119, ADR-0120, ADR-0121]
superseded_by: null
---

# ADR-0122: Current Canonical Activity Projection and Deferred Identity Replay

v0.41 要解决的是九个 Runtime 的结构化活动不再统一显示成“运行命令”。ADR-0119～ADR-0121
把未来可能需要的历史身份 replay、并行 Binding Set、sealed Manifest 和 live head 发布协议提前纳入
当前版本，显著超过了这个问题所需的物理复杂度。v0.41 又采用本地数据 clean break，不存在必须
同时兼容旧分组语义的发布约束。

## Decision

### 1. v0.41 使用一张当前 Canonical Activity Projection

Core 保留 append-only `agent_run_execution_evidence`，并维护一张
`canonical_runtime_activity` 当前投影表。活动 Evidence 写入时，Core 在同一个 SQLite 事务中：

1. 根据严格身份优先级确定 `operationId`；
2. 使用版本化 Mapping Registry 分类；
3. insert 或 update 该 operation 的当前 Canonical Activity；
4. 提交 Evidence 与 Projection。

Projection 以 `(agentRunId, executionEpoch, operationId, classifierVersion)` 唯一标识，并记录
首末 Evidence sequence、Evidence ID 集合和 revision。started、progress、terminal 共享相同稳定
`operationId` 时更新同一行；缺少稳定 ID 时以该 Evidence ID 建立独立 operation，禁止模糊合并。

### 2. v0.41 只实现当前 Mapping Registry

`classifierVersion = activity-v1`。结构化 Core Action ID 优先，其次使用 Runtime native ID，最后使用
Evidence ID。Mapping 只能读取 Runtime/Core 已报告的结构化字段；title 只可作为已观测的
`presentationHint`，不能反过来决定活动域或已执行效果。

v0.41 的 wire 字段采用更准确的 `activityDomain`，局部替代 ADR-0114 保留
`capabilityKind` 字段名的决定，但保留其稳定顶层观测域语义。

Renderer 只消费 Core 输出的 `activityDomain`、`semanticKind`、`toolName`、`presentationHint`、
`phase` 与 `outcome`，不再实现第二套分类或生命周期相关性算法。

### 3. 历史身份 replay 基础设施推迟

v0.41 不实现独立 operation registry、Evidence-operation Binding Ledger、immutable Binding Set、
Manifest、staging/seal/publish、default head、identity replay 或运行中并行 diagnostic grouping。

新 classifier 默认只影响新 operation；进行中的 operation 固定首次建立时的 classifierVersion，历史
Projection 不自动重算。若未来确实需要用新身份规则重组历史 Evidence，同时保留旧分组并可回滚，
届时再通过新的 ADR 和实现设计 replay/parallel projection 基础设施。

## Consequences

- v0.41 用最小数据模型解决工具语义和 lifecycle 合并问题；
- Evidence 仍足以在未来重建 Projection，但当前版本不为尚未发生的历史身份 replay 预付复杂度；
- 当前 Projection 是可更新的派生状态，不是不可变事实真源；
- 若未来引入并行历史解释，需要新的 schema、选择协议和迁移决策，不能偷偷扩张当前表语义。

## Rejected alternatives

- v0.41 为每个 Evidence 水位发布一个不可变 Binding Set；
- 当前就实现 Binding Ledger、sealed Manifest 和 default head；
- 用 title、命令字符串、Runtime 名称、时间邻接或工作区变化推断活动类别或合并 operation；
- 把 Canonical Projection 当成不可变事实真源。

## References

- [ADR-0111: Core-Owned Canonical Runtime Activity and Observation-Honest Lifecycle Projection](0111-core-owned-canonical-runtime-activity.md)
- [ADR-0112: Immutable Execution Evidence and Rebuildable Versioned Canonical Activity Projection](0112-immutable-execution-evidence-and-rebuildable-canonical-activity-projection.md)
- [ADR-0113: Core-Scoped Operation Identity and Evidence Deduplication Boundary](0113-core-scoped-operation-identity-and-evidence-deduplication-boundary.md)
- [ADR-0116: Projection-Pinned Classifier Version and Explicit Historical Reprojection](0116-projection-pinned-classifier-version-and-explicit-historical-reprojection.md)
- [ADR-0119: Append-Only Versioned Evidence-to-Operation Identity Bindings](0119-versioned-evidence-to-operation-identity-bindings.md)
- [ADR-0120: Run-Epoch-Pinned Identity Rules and Frozen Evidence Binding Sets](0120-run-epoch-pinned-identity-rules-and-frozen-binding-sets.md)
- [ADR-0121: Append-Only Binding Ledger and Immutable Sealed Binding-Set Heads](0121-append-only-binding-ledger-and-sealed-binding-set-heads.md)
