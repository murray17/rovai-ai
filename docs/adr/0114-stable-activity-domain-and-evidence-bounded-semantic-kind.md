---
document_type: adr
id: ADR-0114
title: Stable Activity Domain and Evidence-Bounded Semantic Kind
status: accepted
date: 2026-08-05
decision_scope: cross-version
source_version: v0.41
supersedes: []
superseded_by: null
---

# ADR-0114: Stable Activity Domain and Evidence-Bounded Semantic Kind

## Context

跨 Runtime 的分类需要一个不会随 UI 标题或 Runtime 产品不断膨胀的稳定顶层词汇，同时还要
允许 Core Tool Catalog 和结构化 Runtime 事件提供更具体的用户意图。`capabilityKind` 这个
字段名容易让人误以为它总是资源能力或已执行效果，因此本 ADR 明确其合同语义。

## Decision

### 1. `capabilityKind` 的合同语义是 Activity Domain

`capabilityKind` 作为 Canonical Activity 的字段名保留；其正式语义是稳定的
顶层观测域（`activityDomain`），不保证资源能力、资源变更或操作成功。v0.41 初始域为：

`shell | file | git | network | tool | permission | runtime | plan | unknown`

`permission`、`runtime`、`plan` 是控制或元活动域，不能被解释为资源效果。`unknown` 是诚实
的可见结果，不是错误地退回 `shell` 或 `tool`。

### 2. `semanticKind` 是可选且有证据边界的细分

`semanticKind` 使用命名空间化值（例如 `file.write`、`git.mutate`、
`tool.team.call_member`、`tool.web.search`、`runtime.subagent.run`），只有以下证据可以赋值：

- 当前 Rovai Tool Catalog 验证过的 Core `canonicalTool`；
- Core Action 与 Runtime 结构化报告之间的可验证绑定；
- Runtime 自己报告的、足以支撑该细分的结构化类型。

命令文本、标题、Runtime 名称和 provider 类型不能提升为 `semanticKind`，也不能改变
`activityDomain`。

### 3. `presentationHint` 永远不是 Canonical 语义

命令内容可以生成诸如 `test.run`、`build.run` 或“搜索代码”的非权威 `presentationHint`，只
用于本地化详情优化。Hint 不得决定 `operationId`、phase、outcome、visibility 或历史分类，
也不得被持久化为已观测的内部行为。

### 4. 词汇扩展必须注册和版本化

新增 Domain 或 Semantic Kind 必须更新 Core mapping registry、版本号、fixture/replay、未知
降级和 Renderer presentation mapping。没有完整证据和回放覆盖时，只能保留已有域或 `unknown`。

## Consequences

- 顶层域稳定，Renderer 不需要维护各 Runtime 的分类分支；
- 用户仍可看到“运行测试”等有帮助的标题，但不会把猜测误写成执行事实；
- permission/runtime/plan 等非资源活动可以被诚实呈现，而不被强行塞进文件或命令类别；
- 若未来改名为 `activityDomain`，必须在新的明确版本中处理字段变化；本版本不为旧本地数据提供兼容迁移。

## Rejected Alternatives

- 让 `capabilityKind` 直接等同于资源效果或成功结果；
- 把所有文件/命令意图和产品标题都永久加入一个扁平枚举；
- 用命令解析器在 Renderer 中决定 Canonical `semanticKind`；
- 把 `test.run` / `build.run` 等 Hint 当作 Runtime 已报告行为。

## References

- [ADR-0111: Core-Owned Canonical Runtime Activity and Observation-Honest Lifecycle Projection](0111-core-owned-canonical-runtime-activity.md)
- [ADR-0112: Immutable Execution Evidence and Rebuildable Versioned Canonical Activity Projection](0112-immutable-execution-evidence-and-rebuildable-canonical-activity-projection.md)
- [ADR-0113: Core-Scoped Operation Identity and Evidence Deduplication Boundary](0113-core-scoped-operation-identity-and-evidence-deduplication-boundary.md)
- [ADR-0115: Evidence-Bounded Activity Phase and Outcome Resolution](0115-evidence-bounded-activity-phase-and-outcome-resolution.md)
- [ADR-0116: Projection-Pinned Classifier Version and Explicit Historical Reprojection](0116-projection-pinned-classifier-version-and-explicit-historical-reprojection.md)
