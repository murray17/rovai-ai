---
document_type: adr
id: ADR-0113
title: Core-Scoped Operation Identity and Evidence Deduplication Boundary
status: accepted
date: 2026-08-05
decision_scope: cross-version
source_version: v0.41
supersedes: []
superseded_by: null
---

# ADR-0113: Core-Scoped Operation Identity and Evidence Deduplication Boundary

## Context

Runtime Evidence 的来源事件身份与用户看到的一项跨阶段操作不是同一个概念。现有
`source_event_key` 可能包含 phase，适合防止同一来源事件重复写入，却不能安全地把
started、progress、terminal 合并；反过来，依赖标题或命令文本做模糊匹配会把相邻操作错误
合并，并在恢复时产生不同结果。

## Decision

### 1. 两种身份严格分离

- `source_event_key` 只标识并去重一条来源 Evidence。它可以包含来源事件类型和 phase，不能
  作为生命周期合并依据。
- `operationId` 由 Core 单独拥有，用于标识一个可跨生命周期阶段合并的观测操作。只有拥有
  相同 `operationId` 的 Evidence 才能形成同一个 Canonical Runtime Activity。

### 2. 身份必须限定在本次观测范围

Operation identity 必须命名空间化，至少包含 `AgentRun` 与 `executionEpoch`，并在可用时绑定
经过验证的 native session/turn identity。相同的 Runtime item ID、toolCall ID 或 action ID
在不同 Run、epoch 或 native session 中永不自动合并。

### 3. Core 只接受可证明的身份来源

身份来源优先级为：

1. Core 已验证的 Action/Team Tool identity；
2. Runtime 结构化报告提供的稳定 identity（例如 Codex item ID、ACP toolCall ID）；
3. Run-level identity，用于 Run-level 活动；
4. 没有稳定 identity 时，为该 Evidence 创建隔离的 `unknown` operation。

标题、命令、cwd、时间窗口、事件相邻性、Runtime 名称和 workspace diff 都不能产生或补强
`operationId`。Core 不做模糊关联。

### 4. 重放必须稳定

Core 生成或解析的 `operationId` 必须持久保存，或能从同一 Evidence、绑定输入和版本规则
确定性重建。Live 与 recovery 使用同一身份规则；身份冲突保留为独立 Evidence/unknown
活动并记录冲突原因，不选择“看起来更像”的一方。

## Consequences

- Evidence 去重和 Activity 生命周期合并可以分别测试、回放和迁移；
- 没有稳定 Runtime identity 的适配器会产生更多 unknown 活动，但不会制造虚假的完整操作；
- Adapter mapping registry 必须声明身份路径、命名空间和冲突 fixture；
- 未来如果要引入跨 Run 的关联，必须另立 ADR，不能放宽本决策的默认边界。

## Rejected Alternatives

- 直接把 `source_event_key` 当作 `operationId`；
- 按 title/command/cwd/时间窗口做启发式合并；
- 用 workspace diff 反推一个缺失的操作身份；
- 允许相同 provider ID 跨 AgentRun 或 Native Session 自动复用。

## References

- [ADR-0111: Core-Owned Canonical Runtime Activity and Observation-Honest Lifecycle Projection](0111-core-owned-canonical-runtime-activity.md)
- [ADR-0112: Immutable Execution Evidence and Rebuildable Versioned Canonical Activity Projection](0112-immutable-execution-evidence-and-rebuildable-canonical-activity-projection.md)
- [ADR-0114: Stable Activity Domain and Evidence-Bounded Semantic Kind](0114-stable-activity-domain-and-evidence-bounded-semantic-kind.md)
- [ADR-0116: Projection-Pinned Classifier Version and Explicit Historical Reprojection](0116-projection-pinned-classifier-version-and-explicit-historical-reprojection.md)
- [ADR-0119: Append-Only Versioned Evidence-to-Operation Identity Bindings](0119-versioned-evidence-to-operation-identity-bindings.md)
