---
document_type: version-decisions
version: v0.41
lifecycle: historical
last_updated: 2026-08-18
---

# v0.41 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0111](#adr-0111) | Core-Owned Canonical Runtime Activity and Observation-Honest Lifecycle Projection | `accepted` |
| [ADR-0112](#adr-0112) | Immutable Execution Evidence and Rebuildable Versioned Canonical Activity Projection | `accepted` |
| [ADR-0113](#adr-0113) | Core-Scoped Operation Identity and Evidence Deduplication Boundary | `accepted` |
| [ADR-0114](#adr-0114) | Stable Activity Domain and Evidence-Bounded Semantic Kind | `accepted` |
| [ADR-0115](#adr-0115) | Evidence-Bounded Activity Phase and Outcome Resolution | `accepted` |
| [ADR-0116](#adr-0116) | Projection-Pinned Classifier Version and Explicit Historical Reprojection | `accepted` |
| [ADR-0117](#adr-0117) | Observation-Capability Coverage Levels Across Runtime Adapters | `accepted` |
| [ADR-0118](#adr-0118) | v0.41 Local Data Clean Break and Managed Reset Boundary | `accepted` |
| [ADR-0119](#adr-0119) | Append-Only Versioned Evidence-to-Operation Identity Bindings | `superseded` |
| [ADR-0120](#adr-0120) | Run-Epoch-Pinned Identity Rules and Frozen Evidence Binding Sets | `superseded` |
| [ADR-0121](#adr-0121) | Append-Only Binding Ledger and Immutable Sealed Binding-Set Heads | `superseded` |
| [ADR-0122](#adr-0122) | Current Canonical Activity Projection and Deferred Identity Replay | `accepted` |
| [ADR-0123](#adr-0123) | Exclusive AgentRun Runtime Processes and Resident Fleet Reuse | `accepted` |

<!-- legacy-adr:begin id=ADR-0111 source-file-sha256=642e2b7c6fbeb7cf426711abe3ab82f958c9b93a78e1b68e4ec11c3c3a68c069 -->
<a id="adr-0111"></a>

## ADR-0111: Core-Owned Canonical Runtime Activity and Observation-Honest Lifecycle Projection

迁移时原路径：`docs/adr/0111-core-owned-canonical-runtime-activity.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0111
title: Core-Owned Canonical Runtime Activity and Observation-Honest Lifecycle Projection
status: accepted
date: 2026-08-05
decision_scope: cross-version
source_version: v0.41
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0111 -->
<a id="adr-0111-context"></a>
### Context

Rovai-ai must present comparable execution activity across different Agent Runtimes without
claiming facts that a Runtime did not report. The product therefore separates provider evidence,
Core-owned semantic activity, lifecycle projection, and Renderer presentation; this gives v0.41 a
stable architectural seam for incremental Runtime mappings.

This decision was explored during the v0.40 design track and formally adopted when v0.41 became the
current version. The v0.40 history remains a frozen implementation snapshot.

<a id="adr-0111-decision"></a>
### Decision

<a id="adr-0111-four-explicit-layers"></a>
#### Four explicit layers

1. **Runtime Evidence** remains append-only evidence of a Runtime-reported event or a fact from a
   Core-intervened operation. It retains source identity and is never expanded into an inferred
   operation.
2. **Canonical Runtime Activity** is a versioned, Core-owned semantic model for one observed
   operation. It carries an `operationId`, capability classification, optional semantic intent,
   phase, outcome, source-Evidence references, and an explicit observation/credibility boundary.
3. **Lifecycle Projection** deterministically merges the activity's started, progress, and terminal
   facts by `operationId`. Live updates and recovery reads must produce the same projection; raw
   Evidence remains intact.
4. **Activity Presentation** is Renderer-only. It localizes title, details, status, disclosure and
   visual treatment, but never reclassifies from a provider title, command string, Runtime name or
   untrusted field.

<a id="adr-0111-classification-authority"></a>
#### Classification authority

`CanonicalActionInput` is not a universal presentation taxonomy. It may contribute classification
only when Core actually scheduled or intervened in the operation, or when a Runtime's structured
report is cryptographically/structurally bound to that Action. It supplements an observed fact and
never broadens it into knowledge of unreported Runtime internals.

`canonicalTool` has semantic priority only when `sourceAuthority` is `core` and the name validates
against the current Rovai Tool Catalog. A Runtime-provided or otherwise untrusted value is retained
as a hint/diagnostic field and cannot determine the Canonical Runtime Activity.

<a id="adr-0111-observation-honesty"></a>
#### Observation honesty

Runtimes that currently expose only Run-level or final-output facts, such as Claude Code and
Antigravity, produce Run lifecycle activity and final responses only. A workspace diff may be
reported as a separate observation, but it cannot be used to reconstruct a command, file operation,
or other hidden Runtime step.

<a id="adr-0111-consequences"></a>
### Consequences

- A new Runtime mapping can be added at the Core semantic seam without adding Renderer-specific
  title heuristics or a second UI taxonomy.
- Provider protocol richness and product-facing semantics can evolve independently while source
  Evidence remains auditable.
- Unknown or insufficiently observed operations remain explicitly unknown instead of being mislabeled
  as Shell commands.
- v0.41 still needs a versioned activity taxonomy, adapter mapping registry, fixture corpus,
  lifecycle replay tests, and a policy for revising classifications without rewriting historical
  observations.

<a id="adr-0111-rejected-alternatives"></a>
### Rejected Alternatives

- Letting Renderer infer activity from command strings, provider titles, or Runtime names.
- Treating `CanonicalActionInput` as the universal cross-Runtime activity taxonomy.
- Inferring hidden operations from final workspace changes.
- Maintaining a separate bespoke activity vocabulary for each Runtime.

<a id="adr-0111-references"></a>
### References

- [ADR-0112: Immutable Execution Evidence and Rebuildable Versioned Canonical Activity Projection](decisions.md#adr-0112)
- [ADR-0113: Core-Scoped Operation Identity and Evidence Deduplication Boundary](decisions.md#adr-0113)
- [ADR-0114: Stable Activity Domain and Evidence-Bounded Semantic Kind](decisions.md#adr-0114)
- [ADR-0115: Evidence-Bounded Activity Phase and Outcome Resolution](decisions.md#adr-0115)
- [ADR-0116: Projection-Pinned Classifier Version and Explicit Historical Reprojection](decisions.md#adr-0116)
- [ADR-0117: Observation-Capability Coverage Levels Across Runtime Adapters](decisions.md#adr-0117)
- [ADR-0118: v0.41 Local Data Clean Break and Managed Reset Boundary](decisions.md#adr-0118)
- [ADR-0059: Runtime-Owned Resource Permissions](../v0.16/decisions.md#adr-0059)
- [ADR-0061: Durable User-Visible and Agent-Inaccessible Execution Evidence](../v0.17/decisions.md#adr-0061)
<!-- legacy-adr-body:end id=ADR-0111 -->
<!-- legacy-adr:end id=ADR-0111 -->

<!-- legacy-adr:begin id=ADR-0112 source-file-sha256=8df9ab1634dd9ee4a67e9b0cafe62872f160fd3656488b7ab6b6d211e5ad3e0e -->
<a id="adr-0112"></a>

## ADR-0112: Immutable Execution Evidence and Rebuildable Versioned Canonical Activity Projection

迁移时原路径：`docs/adr/0112-immutable-execution-evidence-and-rebuildable-canonical-activity-projection.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0112
title: Immutable Execution Evidence and Rebuildable Versioned Canonical Activity Projection
status: accepted
date: 2026-08-05
decision_scope: cross-version
source_version: v0.41
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0112 -->
<a id="adr-0112-context"></a>
### Context

v0.41 需要在不伪造 Runtime 内部行为的前提下持续改进跨 Runtime 分类。若把当前分类结果当作唯一事实，任何规则修正都会污染历史；若每次读取都临时猜测，实时与恢复又会漂移。因此事实权威和语义 Projection 必须分层，并且 Projection 必须可重建。

<a id="adr-0112-decision"></a>
### Decision

<a id="adr-0112-1-execution-evidence-是唯一不可变事实真源"></a>
#### 1. Execution Evidence 是唯一不可变事实真源

Runtime 实际报告的事件和 Core 实际介入的事实以 append-only Execution Evidence 保存。Evidence 的来源身份、序列、观测内容边界和脱敏结果不可因分类规则变化而修改。缺少 Evidence 不能被补写为“已执行”。

<a id="adr-0112-2-canonical-runtime-activity-是持久且可重建的-core-projection"></a>
#### 2. Canonical Runtime Activity 是持久且可重建的 Core Projection

Core 根据 Evidence 和经过验证的 Core Action 绑定生成 Canonical Runtime Activity，并持久保存它，供 Read Side 和恢复读取使用。每个 Projection 必须引用其来源 Evidence，并记录 classifier/contract/projection version。持久化不是新的事实真源：给定相同 Evidence、绑定输入和版本规则，Projection 必须能够被确定性重建。

<a id="adr-0112-3-分类升级不得静默改写历史"></a>
#### 3. 分类升级不得静默改写历史

分类规则升级生成新的 Canonical Projection/version；旧 Evidence 和原始 Projection 版本保留。默认历史读取保持 Projection 首次建立时固定的观察版本。`classifierVersion` 属于默认 Canonical Projection，不属于也不改变 `operationId`。任何重投影、比较或迁移必须带有显式版本标识、可追溯输入和回放结果，不能把新分类悄悄覆盖到用户已经看到的历史活动上。

<a id="adr-0112-4-lifecycle-projection-依赖版本化-canonical-activity"></a>
#### 4. Lifecycle Projection 依赖版本化 Canonical Activity

Lifecycle Projection 对同一 `operationId` 的 started/progress/terminal 事实执行确定性合并。它可以是进一步的 Read Side 派生层，但不能删除或重写 Evidence/Canonical Activity；live 和 recovery 必须使用同一版本化输入与规则。

<a id="adr-0112-consequences"></a>
### Consequences

- Runtime mapping 可以独立迭代，历史证据仍可审计和重放；
- 需要为 Projection 保存版本、来源引用和重建失败状态；v0.41 内部重投影不能只改一列枚举，也不能借此引入旧版本本地数据兼容；
- Read Side 需要明确默认历史版本和显式重投影入口；
- Fixture、replay、mapping registry 和 classifier 版本成为每次语义变更的必需交付物。

<a id="adr-0112-rejected-alternatives"></a>
### Rejected Alternatives

- 把 Canonical Activity 当成不可追溯的唯一事实表，直接覆盖旧分类；
- 每次 Renderer 读取时从标题、命令或 Runtime 名称即时猜测分类；
- 只保存 Evidence、完全依赖无版本的临时重算，导致实时/恢复和历史展示无法稳定复现；
- 从工作区 diff 或最终回复推导并持久化未报告的内部步骤。

<a id="adr-0112-references"></a>
### References

- [ADR-0111: Core-Owned Canonical Runtime Activity and Observation-Honest Lifecycle Projection](decisions.md#adr-0111)
- [ADR-0113: Core-Scoped Operation Identity and Evidence Deduplication Boundary](decisions.md#adr-0113)
- [ADR-0116: Projection-Pinned Classifier Version and Explicit Historical Reprojection](decisions.md#adr-0116)
- [ADR-0118: v0.41 Local Data Clean Break and Managed Reset Boundary](decisions.md#adr-0118)
- [ADR-0059: Runtime-Owned Resource Permissions](../v0.16/decisions.md#adr-0059)
- [ADR-0061: Durable User-Visible and Agent-Inaccessible Execution Evidence](../v0.17/decisions.md#adr-0061)
<!-- legacy-adr-body:end id=ADR-0112 -->
<!-- legacy-adr:end id=ADR-0112 -->

<!-- legacy-adr:begin id=ADR-0113 source-file-sha256=2bc7b4ec975d64d2fb7bb7b8a86b596a19acfa5eafdc196a4d549b04c4a99b8c -->
<a id="adr-0113"></a>

## ADR-0113: Core-Scoped Operation Identity and Evidence Deduplication Boundary

迁移时原路径：`docs/adr/0113-core-scoped-operation-identity-and-evidence-deduplication-boundary.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0113
title: Core-Scoped Operation Identity and Evidence Deduplication Boundary
status: accepted
date: 2026-08-05
decision_scope: cross-version
source_version: v0.41
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0113 -->
<a id="adr-0113-context"></a>
### Context

Runtime Evidence 的来源事件身份与用户看到的一项跨阶段操作不是同一个概念。现有
`source_event_key` 可能包含 phase，适合防止同一来源事件重复写入，却不能安全地把
started、progress、terminal 合并；反过来，依赖标题或命令文本做模糊匹配会把相邻操作错误
合并，并在恢复时产生不同结果。

<a id="adr-0113-decision"></a>
### Decision

<a id="adr-0113-1-两种身份严格分离"></a>
#### 1. 两种身份严格分离

- `source_event_key` 只标识并去重一条来源 Evidence。它可以包含来源事件类型和 phase，不能
  作为生命周期合并依据。
- `operationId` 由 Core 单独拥有，用于标识一个可跨生命周期阶段合并的观测操作。只有拥有
  相同 `operationId` 的 Evidence 才能形成同一个 Canonical Runtime Activity。

<a id="adr-0113-2-身份必须限定在本次观测范围"></a>
#### 2. 身份必须限定在本次观测范围

Operation identity 必须命名空间化，至少包含 `AgentRun` 与 `executionEpoch`，并在可用时绑定
经过验证的 native session/turn identity。相同的 Runtime item ID、toolCall ID 或 action ID
在不同 Run、epoch 或 native session 中永不自动合并。

<a id="adr-0113-3-core-只接受可证明的身份来源"></a>
#### 3. Core 只接受可证明的身份来源

身份来源优先级为：

1. Core 已验证的 Action/Team Tool identity；
2. Runtime 结构化报告提供的稳定 identity（例如 Codex item ID、ACP toolCall ID）；
3. Run-level identity，用于 Run-level 活动；
4. 没有稳定 identity 时，为该 Evidence 创建隔离的 `unknown` operation。

标题、命令、cwd、时间窗口、事件相邻性、Runtime 名称和 workspace diff 都不能产生或补强
`operationId`。Core 不做模糊关联。

<a id="adr-0113-4-重放必须稳定"></a>
#### 4. 重放必须稳定

Core 生成或解析的 `operationId` 必须持久保存，或能从同一 Evidence、绑定输入和版本规则
确定性重建。Live 与 recovery 使用同一身份规则；身份冲突保留为独立 Evidence/unknown
活动并记录冲突原因，不选择“看起来更像”的一方。

<a id="adr-0113-consequences"></a>
### Consequences

- Evidence 去重和 Activity 生命周期合并可以分别测试、回放和迁移；
- 没有稳定 Runtime identity 的适配器会产生更多 unknown 活动，但不会制造虚假的完整操作；
- Adapter mapping registry 必须声明身份路径、命名空间和冲突 fixture；
- 未来如果要引入跨 Run 的关联，必须另立 ADR，不能放宽本决策的默认边界。

<a id="adr-0113-rejected-alternatives"></a>
### Rejected Alternatives

- 直接把 `source_event_key` 当作 `operationId`；
- 按 title/command/cwd/时间窗口做启发式合并；
- 用 workspace diff 反推一个缺失的操作身份；
- 允许相同 provider ID 跨 AgentRun 或 Native Session 自动复用。

<a id="adr-0113-references"></a>
### References

- [ADR-0111: Core-Owned Canonical Runtime Activity and Observation-Honest Lifecycle Projection](decisions.md#adr-0111)
- [ADR-0112: Immutable Execution Evidence and Rebuildable Versioned Canonical Activity Projection](decisions.md#adr-0112)
- [ADR-0114: Stable Activity Domain and Evidence-Bounded Semantic Kind](decisions.md#adr-0114)
- [ADR-0116: Projection-Pinned Classifier Version and Explicit Historical Reprojection](decisions.md#adr-0116)
- [ADR-0119: Append-Only Versioned Evidence-to-Operation Identity Bindings](decisions.md#adr-0119)
<!-- legacy-adr-body:end id=ADR-0113 -->
<!-- legacy-adr:end id=ADR-0113 -->

<!-- legacy-adr:begin id=ADR-0114 source-file-sha256=30eb5f4dde226ae9dfe63cedf911b11e444c1ed918f53173e134708cada8f48c -->
<a id="adr-0114"></a>

## ADR-0114: Stable Activity Domain and Evidence-Bounded Semantic Kind

迁移时原路径：`docs/adr/0114-stable-activity-domain-and-evidence-bounded-semantic-kind.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0114
title: Stable Activity Domain and Evidence-Bounded Semantic Kind
status: accepted
date: 2026-08-05
decision_scope: cross-version
source_version: v0.41
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0114 -->
<a id="adr-0114-context"></a>
### Context

跨 Runtime 的分类需要一个不会随 UI 标题或 Runtime 产品不断膨胀的稳定顶层词汇，同时还要
允许 Core Tool Catalog 和结构化 Runtime 事件提供更具体的用户意图。`capabilityKind` 这个
字段名容易让人误以为它总是资源能力或已执行效果，因此本 ADR 明确其合同语义。

<a id="adr-0114-decision"></a>
### Decision

<a id="adr-0114-1-capabilitykind-的合同语义是-activity-domain"></a>
#### 1. `capabilityKind` 的合同语义是 Activity Domain

`capabilityKind` 作为 Canonical Activity 的字段名保留；其正式语义是稳定的
顶层观测域（`activityDomain`），不保证资源能力、资源变更或操作成功。v0.41 初始域为：

`shell | file | git | network | tool | permission | runtime | plan | unknown`

`permission`、`runtime`、`plan` 是控制或元活动域，不能被解释为资源效果。`unknown` 是诚实
的可见结果，不是错误地退回 `shell` 或 `tool`。

<a id="adr-0114-2-semantickind-是可选且有证据边界的细分"></a>
#### 2. `semanticKind` 是可选且有证据边界的细分

`semanticKind` 使用命名空间化值（例如 `file.write`、`git.mutate`、
`tool.team.call_member`、`tool.web.search`、`runtime.subagent.run`），只有以下证据可以赋值：

- 当前 Rovai Tool Catalog 验证过的 Core `canonicalTool`；
- Core Action 与 Runtime 结构化报告之间的可验证绑定；
- Runtime 自己报告的、足以支撑该细分的结构化类型。

命令文本、标题、Runtime 名称和 provider 类型不能提升为 `semanticKind`，也不能改变
`activityDomain`。

<a id="adr-0114-3-presentationhint-永远不是-canonical-语义"></a>
#### 3. `presentationHint` 永远不是 Canonical 语义

命令内容可以生成诸如 `test.run`、`build.run` 或“搜索代码”的非权威 `presentationHint`，只
用于本地化详情优化。Hint 不得决定 `operationId`、phase、outcome、visibility 或历史分类，
也不得被持久化为已观测的内部行为。

<a id="adr-0114-4-词汇扩展必须注册和版本化"></a>
#### 4. 词汇扩展必须注册和版本化

新增 Domain 或 Semantic Kind 必须更新 Core mapping registry、版本号、fixture/replay、未知
降级和 Renderer presentation mapping。没有完整证据和回放覆盖时，只能保留已有域或 `unknown`。

<a id="adr-0114-consequences"></a>
### Consequences

- 顶层域稳定，Renderer 不需要维护各 Runtime 的分类分支；
- 用户仍可看到“运行测试”等有帮助的标题，但不会把猜测误写成执行事实；
- permission/runtime/plan 等非资源活动可以被诚实呈现，而不被强行塞进文件或命令类别；
- 若未来改名为 `activityDomain`，必须在新的明确版本中处理字段变化；本版本不为旧本地数据提供兼容迁移。

<a id="adr-0114-rejected-alternatives"></a>
### Rejected Alternatives

- 让 `capabilityKind` 直接等同于资源效果或成功结果；
- 把所有文件/命令意图和产品标题都永久加入一个扁平枚举；
- 用命令解析器在 Renderer 中决定 Canonical `semanticKind`；
- 把 `test.run` / `build.run` 等 Hint 当作 Runtime 已报告行为。

<a id="adr-0114-references"></a>
### References

- [ADR-0111: Core-Owned Canonical Runtime Activity and Observation-Honest Lifecycle Projection](decisions.md#adr-0111)
- [ADR-0112: Immutable Execution Evidence and Rebuildable Versioned Canonical Activity Projection](decisions.md#adr-0112)
- [ADR-0113: Core-Scoped Operation Identity and Evidence Deduplication Boundary](decisions.md#adr-0113)
- [ADR-0115: Evidence-Bounded Activity Phase and Outcome Resolution](decisions.md#adr-0115)
- [ADR-0116: Projection-Pinned Classifier Version and Explicit Historical Reprojection](decisions.md#adr-0116)
<!-- legacy-adr-body:end id=ADR-0114 -->
<!-- legacy-adr:end id=ADR-0114 -->

<!-- legacy-adr:begin id=ADR-0115 source-file-sha256=b8d124057771b120e919852ba16b8ecb0fa5d09285c0b0f115e0b0389a77aa90 -->
<a id="adr-0115"></a>

## ADR-0115: Evidence-Bounded Activity Phase and Outcome Resolution

迁移时原路径：`docs/adr/0115-evidence-bounded-activity-phase-and-outcome-resolution.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0115
title: Evidence-Bounded Activity Phase and Outcome Resolution
status: accepted
date: 2026-08-05
decision_scope: cross-version
source_version: v0.41
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0115 -->
<a id="adr-0115-context"></a>
### Context

Runtime 事件的生命周期位置和操作结果经常以不同事件、不同字段甚至不同可靠性到达。若把
`completed` 当作结果，或让 Run 终态覆盖子操作，就会把取消、失败和效果未知混成同一个状态。

<a id="adr-0115-decision"></a>
### Decision

<a id="adr-0115-1-phase-与-outcome-分离"></a>
#### 1. Phase 与 Outcome 分离

Canonical Activity 的 `phase` 只表示观测到的生命周期位置：started、progress 或 terminal。
`outcome` 单独表示证据边界内的结果。waiting 是非终态状态，不改变“尚未有终端结果”的事实。

<a id="adr-0115-2-结果解析边界"></a>
#### 2. 结果解析边界

- 明确非零 exit code、结构化 error 或 Runtime failed → `failed`；
- 明确 declined/denied 且 Core 证明没有执行 → `denied`；
- 明确 success 且 effect disposition 一致 → `succeeded`；
- Core 证明尚未 dispatch → `cancelled` / `not_executed`；
- dispatch 可能已开始但没有权威终端回执 → `unsettled`；
- 证据不足或无法解决冲突 → `unknown`，必要时同时保留 `unsettled` 的效果待确认标记。

`unsettled` 不是失败、成功或普通用户取消的同义词；它明确表示外部效果仍可能发生。

<a id="adr-0115-3-冲突乱序与-run-终态"></a>
#### 3. 冲突、乱序与 Run 终态

冲突终端 Evidence 全部保留，Projection 不采用最后到达事件覆盖先前事实，而是确定性地
投影为 `unknown` / `unsettled` 并记录冲突来源。Run 终态本身不能为未闭合的子操作补造
`completed`；子操作必须依据自身 Evidence 和 dispatch 边界决定 cancelled、unsettled 或
unknown。

<a id="adr-0115-4-live-与-recovery-使用同一规则"></a>
#### 4. Live 与 Recovery 使用同一规则

结果解析、终态优先级、缺失 start/terminal、重复和乱序处理必须是 Core/Read Side 共享的
纯规则，并以合同版本记录。Renderer 只本地化已解析的 phase/outcome。

<a id="adr-0115-consequences"></a>
### Consequences

- 用户可以区分“没有执行”“执行失败”和“结果待确认”；
- 取消后的潜在外部效果不会被 UI 假装成安全失败；
- Adapter 必须提供足够的 dispatch/terminal 证据，否则会产生更多 unsettled/unknown；
- 需要 fixture 覆盖冲突终端、缺失 start、Run 取消和恢复重放。

<a id="adr-0115-rejected-alternatives"></a>
### Rejected Alternatives

- 只按事件名把 `activity.completed` 显示为成功；
- Run 失败/取消时为所有子操作批量补造失败/完成；
- 采用最后到达终端事件覆盖冲突事实；
- 把 dispatch 可能已开始的取消显示为普通 `cancelled` 或 `failed`。

<a id="adr-0115-references"></a>
### References

- [ADR-0111: Core-Owned Canonical Runtime Activity and Observation-Honest Lifecycle Projection](decisions.md#adr-0111)
- [ADR-0112: Immutable Execution Evidence and Rebuildable Versioned Canonical Activity Projection](decisions.md#adr-0112)
- [ADR-0113: Core-Scoped Operation Identity and Evidence Deduplication Boundary](decisions.md#adr-0113)
- [ADR-0114: Stable Activity Domain and Evidence-Bounded Semantic Kind](decisions.md#adr-0114)
- [ADR-0116: Projection-Pinned Classifier Version and Explicit Historical Reprojection](decisions.md#adr-0116)
<!-- legacy-adr-body:end id=ADR-0115 -->
<!-- legacy-adr:end id=ADR-0115 -->

<!-- legacy-adr:begin id=ADR-0116 source-file-sha256=9e9a09d25fdfea065f81d60ff787b026692e78632ea61ca0e41d2f0ab2b33fdc -->
<a id="adr-0116"></a>

## ADR-0116: Projection-Pinned Classifier Version and Explicit Historical Reprojection

迁移时原路径：`docs/adr/0116-projection-pinned-classifier-version-and-explicit-historical-reprojection.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0116
title: Projection-Pinned Classifier Version and Explicit Historical Reprojection
status: accepted
date: 2026-08-05
decision_scope: cross-version
source_version: v0.41
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0116 -->
<a id="adr-0116-context"></a>
### Context

v0.41 需要允许分类规则持续修正，同时保证一个操作的身份和历史展示不会因新规则而漂移。
`operationId` 标识观测操作；`classifierVersion` 描述如何解释该操作的 Evidence。这两个
概念必须分开。

<a id="adr-0116-decision"></a>
### Decision

<a id="adr-0116-1-版本固定在默认-canonical-projection"></a>
#### 1. 版本固定在默认 Canonical Projection

一个 operation 首次建立其默认 Canonical Runtime Activity Projection 时，Core 固定当时的
`classifierVersion` / contract version。该版本在同一 operation 的 started、progress、terminal
生命周期内保持不变，并用于默认历史读取。

`classifierVersion` 不是 `operationId` 的组成部分，不改变 operation identity，也不允许
因为分类器升级而把同一 operation 拆成新的 operation。

<a id="adr-0116-2-分类升级生成显式平行-projection"></a>
#### 2. 分类升级生成显式平行 Projection

新分类器可以针对旧 Evidence replay，生成带新版本的 parallel reprojection。旧 Evidence 和
默认 Projection 保留；Renderer、Read Side 或迁移工具必须明确标示所使用的 Projection version。
新投影不能静默替换用户已经看到的默认历史。

<a id="adr-0116-3-live-operation-不中途换-classifier"></a>
#### 3. Live operation 不中途换 classifier

一个尚未 terminal 的 operation 继续使用其默认 Projection 的固定 classifierVersion。若规则
在其执行期间升级，升级只影响后续 operation 或显式 replay，不改变当前卡片的语义。

<a id="adr-0116-4-显式迁移必须可追溯可回滚"></a>
#### 4. 显式迁移必须可追溯、可回滚

若产品未来要把某个新 Projection 设为默认，必须有版本化 migration、输入 Evidence digest、
旧/新投影对照、审计记录和回滚边界。没有这些证据时，旧 Projection 继续是默认。

<a id="adr-0116-consequences"></a>
### Consequences

- operation identity、分类规则和历史呈现可以独立演进；
- 需要保存 Projection version、classifier digest 和 replay provenance；
- Read Side 必须定义默认版本与显式版本查询的接口边界；
- 分类修复不会自动改变用户已审阅的历史，但可能暂时保留多个并行解释。

<a id="adr-0116-rejected-alternatives"></a>
### Rejected Alternatives

- 把 classifierVersion 拼进 operationId；
- 新分类器上线后静默重写所有历史卡片；
- 在一个 operation 生命周期中按最新规则动态换分类器；
- 丢弃旧 Projection，只保留新分类结果。

<a id="adr-0116-references"></a>
### References

- [ADR-0111: Core-Owned Canonical Runtime Activity and Observation-Honest Lifecycle Projection](decisions.md#adr-0111)
- [ADR-0112: Immutable Execution Evidence and Rebuildable Versioned Canonical Activity Projection](decisions.md#adr-0112)
- [ADR-0113: Core-Scoped Operation Identity and Evidence Deduplication Boundary](decisions.md#adr-0113)
- [ADR-0114: Stable Activity Domain and Evidence-Bounded Semantic Kind](decisions.md#adr-0114)
- [ADR-0115: Evidence-Bounded Activity Phase and Outcome Resolution](decisions.md#adr-0115)
- [ADR-0117: Observation-Capability Coverage Levels Across Runtime Adapters](decisions.md#adr-0117)
- [ADR-0118: v0.41 Local Data Clean Break and Managed Reset Boundary](decisions.md#adr-0118)
- [ADR-0119: Append-Only Versioned Evidence-to-Operation Identity Bindings](decisions.md#adr-0119)
<!-- legacy-adr-body:end id=ADR-0116 -->
<!-- legacy-adr:end id=ADR-0116 -->

<!-- legacy-adr:begin id=ADR-0117 source-file-sha256=28f6752a5c25fae43154bdb6812396f8f14d5c59e9c96435ee75caf4fdfbcaa2 -->
<a id="adr-0117"></a>

## ADR-0117: Observation-Capability Coverage Levels Across Runtime Adapters

迁移时原路径：`docs/adr/0117-observation-capability-coverage-levels-across-runtime-adapters.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0117
title: Observation-Capability Coverage Levels Across Runtime Adapters
status: accepted
date: 2026-08-05
decision_scope: cross-version
source_version: v0.41
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0117 -->
<a id="adr-0117-context"></a>
### Context

九个已接入 Runtime 的协议暴露程度不同。若把“是否支持某 Runtime”和“Core 能观察到多少
活动”混成一个等级，Renderer 会被迫用推断填补协议缺口，最终制造虚假的细粒度 Evidence。

<a id="adr-0117-decision"></a>
### Decision

<a id="adr-0117-1-全部-runtime-共用一份-canonical-合同"></a>
#### 1. 全部 Runtime 共用一份 Canonical 合同

所有已接入 Runtime 都必须进入同一 Canonical Runtime Activity、Lifecycle Projection 和
Renderer Presentation 合同。合同覆盖范围不因某个 Runtime 暂时只能提供 Run-level 事实而被拆成
另一套语义。

<a id="adr-0117-2-coverage-level-只描述观测能力"></a>
#### 2. Coverage level 只描述观测能力

Mapping Registry 为每个 Adapter/协议版本登记以下 coverage level：

- `fine_grained`：协议实际报告足够的结构化操作身份、阶段和/或结果，可映射到细粒度活动；
- `run_level`：协议只可靠地报告 Run 开始、处理、终态或最终回复；
- `unknown`：能力未验证、字段冲突或无法安全归类。

Coverage level 描述 Core 实际可观察的协议事实，不代表产品支持等级、质量、权限或 Runtime
可靠性。低 coverage level 不能通过最终工作区变化、最终回复、标题、命令字符串或 provider
名称推断升级。

<a id="adr-0117-3-v041-的初始分层"></a>
#### 3. v0.41 的初始分层

Codex 和 ACP 六个 Runtime 在结构化事件存在且 fixture/replay 通过时提供细粒度映射；Claude
Code、Antigravity 当前注册 Run-level 映射，并保留 Core 确实介入的 Team Tool 活动。所有
Runtime 都必须诚实地呈现其 `run_level`/`unknown` 边界。

<a id="adr-0117-4-升级必须有证据"></a>
#### 4. 升级必须有证据

从 `run_level` 或 `unknown` 升级到 `fine_grained` 必须新增 mapping registry 条目、稳定
operation identity 证明、正例/未知/冲突/恢复 fixture、replay 结果和必要的真实 Runtime smoke。
没有这些证据时，Adapter 保持原 coverage level。

<a id="adr-0117-consequences"></a>
### Consequences

- 统一合同不会要求 Runtime 伪造自己没有的内部事件；
- 用户能区分“产品支持”与“本次协议实际观察到的范围”；
- 新 Runtime 可以先安全接入 Run-level，再以证据驱动逐步细化；
- Read Side 和 Renderer 必须展示 coverage/credibility 边界，而不是隐藏缺口。

<a id="adr-0117-rejected-alternatives"></a>
### Rejected Alternatives

- 为每个 Runtime 维护一套互不兼容的 Canonical Activity schema；
- 把 coverage level 当作产品支持评级或质量分数；
- 从 workspace diff、最终回复或 Runtime 名称补造细粒度步骤；
- 让未验证的 Adapter 自动宣称 `fine_grained`。

<a id="adr-0117-references"></a>
### References

- [ADR-0111: Core-Owned Canonical Runtime Activity and Observation-Honest Lifecycle Projection](decisions.md#adr-0111)
- [ADR-0114: Stable Activity Domain and Evidence-Bounded Semantic Kind](decisions.md#adr-0114)
- [ADR-0116: Projection-Pinned Classifier Version and Explicit Historical Reprojection](decisions.md#adr-0116)
<!-- legacy-adr-body:end id=ADR-0117 -->
<!-- legacy-adr:end id=ADR-0117 -->

<!-- legacy-adr:begin id=ADR-0118 source-file-sha256=e8ebaf1d6a5e9702718cc949c890d5840889f32bcdedac9bbaa99c23d44a3d6e -->
<a id="adr-0118"></a>

## ADR-0118: v0.41 Local Data Clean Break and Managed Reset Boundary

迁移时原路径：`docs/adr/0118-v041-local-data-clean-break-and-managed-reset-boundary.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0118
title: v0.41 Local Data Clean Break and Managed Reset Boundary
status: accepted
date: 2026-08-05
decision_scope: version-scope
source_version: v0.41
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0118 -->
<a id="adr-0118-context"></a>
### Context

v0.41 的 Canonical Activity Projection、版本化分类和生命周期合同会改变本地持久化结构。
为旧版本数据库设计兼容迁移会扩大状态空间、保留不再可信的旧语义，并降低新合同的验证阈值。

<a id="adr-0118-decision"></a>
### Decision

<a id="adr-0118-1-v041-不兼容-v040-及更早本地数据"></a>
#### 1. v0.41 不兼容 v0.40 及更早本地数据

v0.41 只接受带有当前 data contract、Projection schema 和必要 catalog/classifier marker 的
Rovai-owned app data。对 v0.40 及更早数据库不做迁移、回填、双读、旧字段兼容或隐式修复。

<a id="adr-0118-2-不兼容时执行受管-clean-reset"></a>
#### 2. 不兼容时执行受管 Clean Reset

启动校验发现缺少 marker、未知 schema、无法验证的 Projection/Evidence 关系、损坏或不兼容
结构时，Core 在明确的 Rovai-owned app-data 根范围内清理并重新初始化 v0.41 store。Reset 必须
留下可诊断的原因和新 store 的 contract marker；不得静默继续读取部分旧数据。

“本地数据”在本 ADR 中不包括用户工作区、用户文件、外部 Runtime 配置或凭据、Native Runtime
Home、项目 `.codex`/Runtime 原生状态。经用户确认，受管 reset allowlist 只包括下表中的
Rovai-owned 路径；它是闭集，不得用 `--data-dir` 根目录递归删除来代替：

| 类别 | `data_dir` 下的受管目标 | 边界 |
| --- | --- | --- |
| SQLite store | `rovai.sqlite`、其 `-wal`/`-shm` sidecar，以及旧名 `lumen.sqlite` 的文件和 sidecar | `lumen.sqlite` 只允许作为不兼容残留清理，v0.41 不读取它 |
| Managed Blob | `managed-blobs/**` | 包括其 `tmp/**` staging 内容 |
| Camp attachment | `camp-attachments/**` | 包括 prepared/temporary attachment 内容 |
| Runtime projection | `runtime/mcp/**`、`runtime/opencode/**`、`runtime/copilot/**`、`runtime/kiro/**`、`runtime/qoder/**`、`runtime/codebuddy/**`、`runtime/qwen/**` | 只清理 Rovai 生成的 projection/config snapshot |
| Runtime private state | `runtime-private/**` | 只清理 Rovai 管理的 Claude/Antigravity/team 私有日志与状态 |
| 隔离 Codex Home | `codex-homes/**` | 仅限 Rovai 为 Camp/成员创建的隔离 Home |
| Quick Chat | `quick-chat/**` | 仅限受管 Quick Chat 工作树和其临时内容 |
| App-owned temporary artifacts | 由 v0.41 reset manifest 明确登记的 `data_dir` 内 staging/lock/temp 子路径 | 未登记的根级或外部临时路径不得删除 |

Core 还可以在进程生命周期清理自己创建的精确 Team Tool endpoint（当前形式为
`/tmp/rovai-team-<pid>/core.sock`），但这不是 app-data reset 的泛化授权；清理必须验证路径
前缀、PID/进程归属和 socket 类型，禁止扫描或递归删除 `/tmp`。

allowlist 外的 `data_dir` 内容既不读取也不删除；启动诊断必须记录不兼容原因、未处理条目和
新 store 的 contract marker。任何新增 Rovai-owned 路径都必须先更新 reset manifest、测试和
本 ADR/后续 ADR，不能借由“临时文件”类别隐式扩大范围。

<a id="adr-0118-3-v041-内部版本化仍然有效"></a>
#### 3. v0.41 内部版本化仍然有效

本 Clean Break 不取消 v0.41 内部的 Evidence append-only、Canonical Projection version、
classifier replay 和显式历史重投影。它只拒绝跨版本本地数据兼容；新 store 建立后，v0.41
自己的历史和并行 Projection 必须继续遵守 ADR-0112 与 ADR-0116。

<a id="adr-0118-consequences"></a>
### Consequences

- Migration 和双表面兼容成本显著降低，v0.41 可以以干净 schema 验证；
- 用户可能丢失 Rovai-owned 的旧本地会话/证据，需要启动诊断明确告知；
- 实现必须有可测试的 contract marker、受管 reset 路径、备份/诊断策略和不触碰外部状态的断言；
- 任何希望保留旧数据的需求都必须另立决策，不能在实现中偷偷加入兼容分支。

<a id="adr-0118-rejected-alternatives"></a>
### Rejected Alternatives

- 为 v0.40 或更早的 Canonical/Execution 数据提供隐式 migration/backfill；
- 同时读取 legacy 和 v0.41 表并按字段猜测优先级；
- 只删除部分无法解析的行而继续使用同一 store；
- 把用户工作区、Runtime credentials 或 Native Home 当作 reset 目标。

<a id="adr-0118-references"></a>
### References

- [ADR-0112: Immutable Execution Evidence and Rebuildable Versioned Canonical Activity Projection](decisions.md#adr-0112)
- [ADR-0116: Projection-Pinned Classifier Version and Explicit Historical Reprojection](decisions.md#adr-0116)
<!-- legacy-adr-body:end id=ADR-0118 -->
<!-- legacy-adr:end id=ADR-0118 -->

<!-- legacy-adr:begin id=ADR-0119 source-file-sha256=4008f0f523fee75dff20a6c96260e984f871a6116763f714b97c0b994313b946 -->
<a id="adr-0119"></a>

## ADR-0119: Append-Only Versioned Evidence-to-Operation Identity Bindings

迁移时原路径：`docs/adr/0119-versioned-evidence-to-operation-identity-bindings.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0119
title: Append-Only Versioned Evidence-to-Operation Identity Bindings
status: superseded
date: 2026-08-05
decision_scope: cross-version
source_version: v0.41
supersedes: []
superseded_by: ADR-0122
```

<!-- legacy-adr-body:begin id=ADR-0119 -->
<a id="adr-0119-context"></a>
### Context

ADR-0113 separates Evidence deduplication from operation identity, while ADR-0116 separates operation
identity from semantic classification. v0.41 also needs a durable rule for binding individual Evidence
to operations without mutating immutable Evidence, silently regrouping history, or letting a classifier
upgrade change lifecycle correlation.

<a id="adr-0119-decision"></a>
### Decision

<a id="adr-0119-1-evidence-to-operation-binding-is-core-owned-and-append-only"></a>
#### 1. Evidence-to-operation binding is Core-owned and append-only

Core models the relationship between activity Evidence and an operation as an explicit identity binding.
When activity Evidence is admitted, the same SQLite transaction must register or reuse an operation and
persist exactly one immutable default binding for that Evidence. Reasoning, narration, final response,
and other non-activity presentation tracks do not receive operation bindings.

`source_event_key`, Evidence identity, operation identity, and binding identity remain separate. A source
key deduplicates one incoming Evidence fact; it never creates or changes a lifecycle grouping.

<a id="adr-0119-2-identity-authority-is-conservative"></a>
#### 2. Identity authority is conservative

Core chooses operation identity in this order:

1. a verified Core operation/Action identity;
2. a stable structured identity reported by the Runtime and fenced by AgentRun, execution epoch, and
   available native session/turn identity;
3. when neither exists, a new isolated `unknown` operation for that one Evidence.

Titles, commands, cwd, timestamps, adjacency, provider names, and workspace changes cannot create a
binding or merge operations.

<a id="adr-0119-3-identity-evolution-uses-a-separate-version-axis"></a>
#### 3. Identity evolution uses a separate version axis

The default binding set is immutable. A later identity improvement may only create a parallel binding
set under a new `operationIdentityVersion`; it cannot update or delete the original binding set. Reads,
replay output, and diagnostics must identify which operation identity version they use, and default
historical reads must not silently switch versions.

`operationIdentityVersion` and `classifierVersion` are orthogonal:

- changing `operationIdentityVersion` may change which Evidence belongs to which operation;
- changing `classifierVersion` may change the semantic Projection of an already selected operation
  binding set, but may not regroup Evidence or change operation identity;
- ordinary classifier reprojection therefore operates within one explicit operation identity version.

<a id="adr-0119-4-projection-and-read-side-consume-explicit-bindings"></a>
#### 4. Projection and Read Side consume explicit bindings

Canonical Runtime Activity Projection is generated only from Evidence selected by an explicit operation
binding set. Lifecycle Read Side groups by the selected `operationId` and Projection version; it does not
implement another correlation algorithm or fall back to provider text.

Live ingestion, recovery, and explicit replay must use the same binding contract. A mapping failure keeps
the Evidence and an honest isolated/unknown result; it does not authorize a best-effort merge.

<a id="adr-0119-consequences"></a>
### Consequences

- identity correction and semantic reclassification can evolve independently and remain auditable;
- the physical schema needs an operation registry, append-only versioned bindings, uniqueness for one
  default binding per activity Evidence, and explicit selection of identity/classifier versions;
- an identity improvement may produce a visibly different parallel lifecycle grouping, but never a
  silent change to the default historical view;
- Runtimes without stable activity identity may show more isolated unknown operations, preserving
  observational honesty at the cost of compactness.

<a id="adr-0119-rejected-alternatives"></a>
### Rejected Alternatives

- storing `operationId` only as mutable derived data on an Evidence row;
- allowing a classifier replay to regroup Evidence;
- late rebinding that silently replaces the default identity relationship;
- deriving lifecycle groups in Renderer or Read Side from titles, commands, timing, or adjacency;
- attaching reasoning, narration, or final-response display records to synthetic operations.

<a id="adr-0119-references"></a>
### References

- [ADR-0111: Core-Owned Canonical Runtime Activity and Observation-Honest Lifecycle Projection](decisions.md#adr-0111)
- [ADR-0112: Immutable Execution Evidence and Rebuildable Versioned Canonical Activity Projection](decisions.md#adr-0112)
- [ADR-0113: Core-Scoped Operation Identity and Evidence Deduplication Boundary](decisions.md#adr-0113)
- [ADR-0116: Projection-Pinned Classifier Version and Explicit Historical Reprojection](decisions.md#adr-0116)
- [ADR-0120: Run-Epoch-Pinned Identity Rules and Frozen Evidence Binding Sets](decisions.md#adr-0120)
<!-- legacy-adr-body:end id=ADR-0119 -->
<!-- legacy-adr:end id=ADR-0119 -->

<!-- legacy-adr:begin id=ADR-0120 source-file-sha256=f869d574fd250d92ca1f1aa43af80a428b9f447fd3e898060cd424c49af69d07 -->
<a id="adr-0120"></a>

## ADR-0120: Run-Epoch-Pinned Identity Rules and Frozen Evidence Binding Sets

迁移时原路径：`docs/adr/0120-run-epoch-pinned-identity-rules-and-frozen-binding-sets.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0120
title: Run-Epoch-Pinned Identity Rules and Frozen Evidence Binding Sets
status: superseded
date: 2026-08-05
decision_scope: cross-version
source_version: v0.41
supersedes: []
superseded_by: ADR-0122
```

<!-- legacy-adr-body:begin id=ADR-0120 -->
<a id="adr-0120-context"></a>
### Context

ADR-0119 requires versioned parallel Evidence-to-operation bindings, but a rule version and one
materialized binding result are not the same identity. Reusing one field for both would make two
replays of the same rule at different Evidence watermarks indistinguishable and could let an in-flight
AgentRun silently change grouping rules.

<a id="adr-0120-decision"></a>
### Decision

<a id="adr-0120-1-operationidentityversion-identifies-immutable-rules"></a>
#### 1. `operationIdentityVersion` identifies immutable rules

`operationIdentityVersion` names one immutable operation-identity rule/registry version. The default
identity rule is pinned for each `(agentRunId, executionEpoch)` when its first activity Evidence is
admitted and cannot change during that epoch, including across Core restart and recovery.

A newer identity rule is used by default only for a new AgentRun execution epoch. It never changes the
default binding semantics of an existing epoch.

<a id="adr-0120-2-operationbindingsetid-identifies-one-complete-materialization"></a>
#### 2. `operationBindingSetId` identifies one complete materialization

`operationBindingSetId` identifies the complete binding set produced by applying one explicit
`operationIdentityVersion` to one AgentRun execution epoch at one frozen Evidence watermark. The set
must retain enough provenance to identify at least:

- `agentRunId` and `executionEpoch`;
- `operationIdentityVersion`;
- the frozen Evidence through-sequence/watermark and an Evidence input digest;
- the identity mapping/registry digest used for the materialization.

Two materializations that use the same identity rule but different Evidence watermarks are different
binding sets. A partial collection of rows is not a valid complete binding set.

<a id="adr-0120-3-historical-identity-improvement-is-explicit-and-parallel"></a>
#### 3. Historical identity improvement is explicit and parallel

Historical identity improvement runs only through an explicit replay over a frozen Evidence input and
creates a parallel binding set with its own `operationBindingSetId`. It does not update the default
identity rule, replace the default binding set, or silently change default historical reads.

An in-flight Run may have a diagnostic replay preview, but it cannot enter the default user-visible
Lifecycle Projection or regroup the live activity stream. A user-visible parallel binding set must be
bound to an explicit frozen Evidence watermark.

<a id="adr-0120-4-classifier-projection-consumes-a-selected-binding-set"></a>
#### 4. Classifier Projection consumes a selected binding set

Canonical Projection must identify the selected `operationBindingSetId` in addition to its own
`classifierVersion` and Projection version. A classifier replay consumes one binding set as fixed
input; it cannot append bindings, change the Evidence watermark, or reinterpret identity rules.

<a id="adr-0120-consequences"></a>
### Consequences

- operation identity rules, materialized grouping results, and semantic classifiers have distinct,
  independently auditable version axes;
- recovery can prove that a Run epoch retained one default identity rule rather than consulting a
  mutable global latest version;
- storage and Read Side APIs must select complete binding sets and reject partial/mixed-watermark rows;
- historical identity improvements require explicit replay provenance and may coexist with the default
  historical grouping without replacing it.

<a id="adr-0120-rejected-alternatives"></a>
### Rejected Alternatives

- using `operationIdentityVersion` as both rule version and binding-set primary key;
- changing the default identity rule of an active or historical AgentRun epoch;
- treating each Evidence or operation as independently versioned identity input within one default Run
  epoch;
- allowing a partially written or mixed-watermark binding collection to drive Lifecycle Projection;
- automatically promoting a replayed binding set to the default historical view.

<a id="adr-0120-references"></a>
### References

- [ADR-0112: Immutable Execution Evidence and Rebuildable Versioned Canonical Activity Projection](decisions.md#adr-0112)
- [ADR-0113: Core-Scoped Operation Identity and Evidence Deduplication Boundary](decisions.md#adr-0113)
- [ADR-0116: Projection-Pinned Classifier Version and Explicit Historical Reprojection](decisions.md#adr-0116)
- [ADR-0119: Append-Only Versioned Evidence-to-Operation Identity Bindings](decisions.md#adr-0119)
- [ADR-0121: Append-Only Binding Ledger and Immutable Sealed Binding-Set Heads](decisions.md#adr-0121)
<!-- legacy-adr-body:end id=ADR-0120 -->
<!-- legacy-adr:end id=ADR-0120 -->

<!-- legacy-adr:begin id=ADR-0121 source-file-sha256=edfa5a9fff13210b4dab25fb02e5a30466a9e9c391b4acaccb06832dc3d14b1a -->
<a id="adr-0121"></a>

## ADR-0121: Append-Only Binding Ledger and Immutable Sealed Binding-Set Heads

迁移时原路径：`docs/adr/0121-append-only-binding-ledger-and-sealed-binding-set-heads.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0121
title: Append-Only Binding Ledger and Immutable Sealed Binding-Set Heads
status: superseded
date: 2026-08-05
decision_scope: cross-version
source_version: v0.41
supersedes: []
superseded_by: ADR-0122
```

<!-- legacy-adr-body:begin id=ADR-0121 -->
<a id="adr-0121-context"></a>
### Context

Activity Evidence arrives while an AgentRun is live, but ADR-0120 defines each readable Binding Set at
a frozen Evidence watermark. A mutable set would therefore make one `operationBindingSetId` mean
different content over time, while delaying all sets until Run termination would give live and recovery
reads different identity inputs.

<a id="adr-0121-decision"></a>
### Decision

<a id="adr-0121-1-default-bindings-use-an-append-only-binding-ledger"></a>
#### 1. Default bindings use an append-only Binding Ledger

Core records default Evidence-to-operation bindings in an append-only Binding Ledger. Existing ledger
facts are never updated or removed to represent a newer Evidence frontier.

<a id="adr-0121-2-every-readable-binding-set-is-immutable-complete-and-sealed"></a>
#### 2. Every readable Binding Set is immutable, complete, and sealed

A Binding Set is eligible for Canonical Projection or Lifecycle Read Side only after it is complete and
sealed. Once sealed, its manifest and logical membership never grow, change, or disappear. Partial,
building, or otherwise unsealed materialization is not a readable Binding Set.

<a id="adr-0121-3-live-progress-publishes-new-sealed-sets-and-advances-the-default-head"></a>
#### 3. Live progress publishes new sealed sets and advances the default head

During an active AgentRun, Core continuously publishes new sealed Binding Sets as the eligible Evidence
frontier advances, then moves that Run epoch's default Binding Set head to the newly sealed set. The head
may advance; the set it previously selected remains immutable and retained.

Old Binding Sets are never grown, overwritten, or deleted. Historical and recovery reads can therefore
name the exact sealed set they consumed even after the default head has advanced.

<a id="adr-0121-4-physical-encoding-remains-a-separate-implementation-gate"></a>
#### 4. Physical encoding remains a separate implementation gate

This decision does not select full-copy versus parent/delta manifests, a content-addressed versus opaque
`operationBindingSetId`, staging-table layout, transaction batching, or the physical representation of
the default head. Those choices must preserve the append-only ledger, sealed-set completeness, immutable
historical sets, and live head semantics above and require separate confirmation before implementation.

<a id="adr-0121-consequences"></a>
### Consequences

- one `operationBindingSetId` has stable meaning for all future reads;
- live and recovery projections can consume the same class of sealed input rather than separate
  correlation paths;
- implementations may structurally share data between sets, but logical manifests and old set identities
  remain retained;
- publication and crash-recovery tests must prove that no partial set becomes readable and that head
  advancement never mutates the previously selected set.

<a id="adr-0121-rejected-alternatives"></a>
### Rejected Alternatives

- appending members to an already readable Binding Set;
- overwriting or deleting the previous set when the default head advances;
- exposing partial/best-effort binding rows as a complete set;
- using only a live mutable ledger and creating the first sealed set at Run termination.

<a id="adr-0121-references"></a>
### References

- [ADR-0112: Immutable Execution Evidence and Rebuildable Versioned Canonical Activity Projection](decisions.md#adr-0112)
- [ADR-0119: Append-Only Versioned Evidence-to-Operation Identity Bindings](decisions.md#adr-0119)
- [ADR-0120: Run-Epoch-Pinned Identity Rules and Frozen Evidence Binding Sets](decisions.md#adr-0120)
<!-- legacy-adr-body:end id=ADR-0121 -->
<!-- legacy-adr:end id=ADR-0121 -->

<!-- legacy-adr:begin id=ADR-0122 source-file-sha256=d4977ca14f81dc618e2e04f03c587e23c029c7339669bf1ac23b8ef80b46293d -->
<a id="adr-0122"></a>

## ADR-0122: Current Canonical Activity Projection and Deferred Identity Replay

迁移时原路径：`docs/adr/0122-current-canonical-activity-projection-and-deferred-identity-replay.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0122
title: Current Canonical Activity Projection and Deferred Identity Replay
status: accepted
date: 2026-08-05
decision_scope: cross-version
source_version: v0.41
supersedes: [ADR-0119, ADR-0120, ADR-0121]
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0122 -->
<a id="adr-0122-context"></a>
### Context

v0.41 要解决的是九个 Runtime 的结构化活动不再统一显示成“运行命令”。ADR-0119～ADR-0121
把未来可能需要的历史身份 replay、并行 Binding Set、sealed Manifest 和 live head 发布协议提前纳入
当前版本，显著超过了这个问题所需的物理复杂度。v0.41 又采用本地数据 clean break，不存在必须
同时兼容旧分组语义的发布约束。

<a id="adr-0122-decision"></a>
### Decision

<a id="adr-0122-1-v041-使用一张当前-canonical-activity-projection"></a>
#### 1. v0.41 使用一张当前 Canonical Activity Projection

Core 保留 append-only `agent_run_execution_evidence`，并维护一张
`canonical_runtime_activity` 当前投影表。活动 Evidence 写入时，Core 在同一个 SQLite 事务中：

1. 根据严格身份优先级确定 `operationId`；
2. 使用版本化 Mapping Registry 分类；
3. insert 或 update 该 operation 的当前 Canonical Activity；
4. 提交 Evidence 与 Projection。

Projection 以 `(agentRunId, executionEpoch, operationId, classifierVersion)` 唯一标识，并记录
首末 Evidence sequence、Evidence ID 集合和 revision。started、progress、terminal 共享相同稳定
`operationId` 时更新同一行；缺少稳定 ID 时以该 Evidence ID 建立独立 operation，禁止模糊合并。

<a id="adr-0122-2-v041-只实现当前-mapping-registry"></a>
#### 2. v0.41 只实现当前 Mapping Registry

`classifierVersion = activity-v1`。结构化 Core Action ID 优先，其次使用 Runtime native ID，最后使用
Evidence ID。Mapping 只能读取 Runtime/Core 已报告的结构化字段；title 只可作为已观测的
`presentationHint`，不能反过来决定活动域或已执行效果。

v0.41 的 wire 字段采用更准确的 `activityDomain`，局部替代 ADR-0114 保留
`capabilityKind` 字段名的决定，但保留其稳定顶层观测域语义。

Renderer 只消费 Core 输出的 `activityDomain`、`semanticKind`、`toolName`、`presentationHint`、
`phase` 与 `outcome`，不再实现第二套分类或生命周期相关性算法。

<a id="adr-0122-3-历史身份-replay-基础设施推迟"></a>
#### 3. 历史身份 replay 基础设施推迟

v0.41 不实现独立 operation registry、Evidence-operation Binding Ledger、immutable Binding Set、
Manifest、staging/seal/publish、default head、identity replay 或运行中并行 diagnostic grouping。

新 classifier 默认只影响新 operation；进行中的 operation 固定首次建立时的 classifierVersion，历史
Projection 不自动重算。若未来确实需要用新身份规则重组历史 Evidence，同时保留旧分组并可回滚，
届时再通过新的 ADR 和实现设计 replay/parallel projection 基础设施。

<a id="adr-0122-consequences"></a>
### Consequences

- v0.41 用最小数据模型解决工具语义和 lifecycle 合并问题；
- Evidence 仍足以在未来重建 Projection，但当前版本不为尚未发生的历史身份 replay 预付复杂度；
- 当前 Projection 是可更新的派生状态，不是不可变事实真源；
- 若未来引入并行历史解释，需要新的 schema、选择协议和迁移决策，不能偷偷扩张当前表语义。

<a id="adr-0122-rejected-alternatives"></a>
### Rejected Alternatives

- v0.41 为每个 Evidence 水位发布一个不可变 Binding Set；
- 当前就实现 Binding Ledger、sealed Manifest 和 default head；
- 用 title、命令字符串、Runtime 名称、时间邻接或工作区变化推断活动类别或合并 operation；
- 把 Canonical Projection 当成不可变事实真源。

<a id="adr-0122-references"></a>
### References

- [ADR-0111: Core-Owned Canonical Runtime Activity and Observation-Honest Lifecycle Projection](decisions.md#adr-0111)
- [ADR-0112: Immutable Execution Evidence and Rebuildable Versioned Canonical Activity Projection](decisions.md#adr-0112)
- [ADR-0113: Core-Scoped Operation Identity and Evidence Deduplication Boundary](decisions.md#adr-0113)
- [ADR-0116: Projection-Pinned Classifier Version and Explicit Historical Reprojection](decisions.md#adr-0116)
- [ADR-0119: Append-Only Versioned Evidence-to-Operation Identity Bindings](decisions.md#adr-0119)
- [ADR-0120: Run-Epoch-Pinned Identity Rules and Frozen Evidence Binding Sets](decisions.md#adr-0120)
- [ADR-0121: Append-Only Binding Ledger and Immutable Sealed Binding-Set Heads](decisions.md#adr-0121)
<!-- legacy-adr-body:end id=ADR-0122 -->
<!-- legacy-adr:end id=ADR-0122 -->

<!-- legacy-adr:begin id=ADR-0123 source-file-sha256=9bcdc281b2a04cd93930cd4b823b31cf8e165faed48558fb585a7678bea6205b -->
<a id="adr-0123"></a>

## ADR-0123: Exclusive AgentRun Runtime Processes and Resident Fleet Reuse

迁移时原路径：`docs/adr/0123-exclusive-agentrun-runtime-fleet.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0123
title: Exclusive AgentRun Runtime Processes and Resident Fleet Reuse
status: accepted
date: 2026-08-06
decision_scope: cross-version
source_version: v0.41
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0123 -->
> [ADR-0126](../v0.43/decisions.md#adr-0126) 局部替代本文的 Codex
> Isolated Home compatibility identity；AgentRun 独占 lease、Resident 配额、quiescence、
> fencing 与 Core restart 语义继续有效。
> [ADR-0129](../v0.44/decisions.md#adr-0129) 删除 Context Compaction
> 专用 Job/Runtime 路径；本文其余 AgentRun Fleet 语义继续有效。

<a id="adr-0123-context"></a>
### Context

Rovai-ai 当前存在三种不一致的 Runtime 进程生命周期：

- Codex app-server 按 ADR-0107 为每个 AgentRun 新建并在 Run 终态关闭；
- ACP Adapter 在没有 Team Tool 且部分进程级配置允许时，可以让多个 AgentRun 共享同一
  Host；有 Team Tool 或严格进程级 MCP 配置时则使用独占 Host；
- Claude Code 与 Antigravity 使用单次调用进程，Run 结束后自然退出。

ACP 共享 Host 使一个进程可以同时路由多个 Session 和 AgentRun。进程级凭据、私有 MCP
投影、工作目录、附件根和 Runtime 自身缓存因此必须同时支持多租户隔离；任何遗漏都会把一个
Run 的配置或事件路由到另一个 Run。另一方面，所有可复用 Runtime 都按 AgentRun 关闭会增加
启动延迟与资源抖动，也无法统一控制空闲进程占用。

需要统一的语义是：一个 Runtime 进程可以串行服务兼容的 AgentRun，但不能同时服务两个
AgentRun。保留并复用的进程必须受到成员级和全局常驻配额约束；配额只控制跨 Run 保留的资源，
不能成为普通 AgentRun 的执行并发上限。常驻池满时，新 Run 仍应通过仅服务本 Run 的 Burst
进程启动。

进程复用还会改变现有凭据生命周期。部分 ACP Runtime 可能在进程内、私有配置文件或它启动的
MCP 子进程中继续保留冻结的外部 MCP 凭据。若主进程进入空闲常驻状态，这些状态不会在
AgentRun 终态立即销毁，必须明确其上限、失效和授权规则，而不能继续声称遵循 ADR-0018 的
逐 Run 立即清理语义。

<a id="adr-0123-decision"></a>
### Decision

<a id="adr-0123-1-正式-agentrun-独占一个-runtime-进程"></a>
#### 1. 正式 AgentRun 独占一个 Runtime 进程

任一时刻，一个 Runtime 进程最多绑定一个正式 AgentRun。Core 不再因为 AgentRun 没有
Team Tool 而允许多个 AgentRun 同时共享一个 ACP Host。Native Session 可以跨 AgentRun
保持连续，但 Session 连续性不赋予并行共享进程的资格。

以下 Runtime 在 Run 结束后可以由 Adapter 证明健康并进入空闲常驻状态：

- Codex CLI；
- OpenCode；
- GitHub Copilot CLI；
- Kiro CLI；
- Qoder CLI；
- CodeBuddy；
- Qwen Code。

Claude Code 与 Antigravity 保持 run-scoped one-shot：它们不进入常驻池，Run 结束后进程自然
退出并从 Fleet 移除。

Context Compaction 等不属于正式 AgentRun 的内部作业继续使用临时独占进程。内部作业不复用
正式 AgentRun 的进程、不进入常驻池，完成后立即关闭。

<a id="adr-0123-2-agentruntimefleetmanager-是唯一正式进程所有者"></a>
#### 2. AgentRuntimeFleetManager 是唯一正式进程所有者

新增深模块 `AgentRuntimeFleetManager`。其外部接口只表达以下操作：

```text
acquire AgentRun process
release AgentRun process
invalidate processes by owned scope
shutdown Fleet
```

调用方不得直接选择共享 Host、修改 Fleet 状态、维护配额或操作 LRU。Manager 在内部封装：

- 创建、复用、停止和 reap Runtime 进程；
- AgentRun 与进程的唯一 lease；
- 成员级和全局 Resident accounting；
- IdleWarm 索引、TTL、LRU 和周期性 Sweeper；
- Core generation、进程所有权证明和崩溃后清理；
- Resident、Burst 与 one-shot 的不同结束策略。

Runtime 差异位于 Adapter seam。Adapter 根据已经冻结的进程启动输入生成 opaque
`runtime_compatibility_digest`，并负责 spawn、健康与 quiescence 判断、Run 绑定/解绑和停止。
Manager 不解析模型、权限、MCP、Team attachment、工作区或 Runtime 私有配置字段。

一次 acquire 返回不可复制的 Runtime lease。lease 至少绑定：

```text
process_id
agent_run_id
execution_epoch
lease_generation
```

进程事件、释放、取消和迟到回调都必须匹配当前 lease；仅持有 `process_id` 或旧
`host_instance_id` 不产生执行权。

<a id="adr-0123-3-复用兼容性采用三项精确相等"></a>
#### 3. 复用兼容性采用三项精确相等

IdleWarm 只有在以下三项全部精确相等时才能复用：

```text
camp_id
agent_profile_id
runtime_compatibility_digest
```

`runtime_compatibility_digest` 由对应 Adapter 在所有进程级启动输入确定后生成，随 AgentRun
冻结并持久化。凡是可能让一个已启动进程与新 Run 不兼容的输入都必须参与该 digest；哪些输入
属于进程级由 Adapter 决定。Manager 不以字段子集、Runtime 名称、Native Session ID 或模糊
匹配替代 digest 相等。

进程级输入发生变化而 Adapter 不能证明已启动进程仍兼容时，Adapter 必须生成不同 digest 或
声明该进程不可复用。纯 Prompt/Turn 级输入可以不进入 digest，但不得因此热改已经固定在进程
中的配置。

`runtime_compatibility_digest` 与 Native Session 的 `binding_compatibility_digest` 是不同身份：
前者决定物理进程能否复用，后者决定原生会话能否继续。进程替换不自动丢弃兼容 Native
Session，Native Session 连续也不允许绕过进程兼容性。

<a id="adr-0123-4-resident-配额只约束跨-run-保留的进程"></a>
#### 4. Resident 配额只约束跨 Run 保留的进程

默认常驻配额为：

```text
max_resident_processes_per_member = 20
max_resident_processes_global = 200
```

一个配额槽位对应一个由 Fleet 登记的 Runtime 根进程，而不是该 Runtime 启动的每个 MCP、Shell
或其他后代进程。后代必须归属于根进程的停止与进程组清理，但不单独消耗 Resident 槽位；因此
20/200 是受管 Runtime 根进程上限，不是整棵进程树的 OS 进程数或内存上限。

成员配额键为 `agent_profile_id`，跨该成员所在的全部 Camp 计算。Resident 进程在以下所有阶段
都占用成员和全局槽位：

```text
Starting
BusyResident
IdleWarm
Stopping
```

`Starting` 在实际 spawn 前原子预留槽位，防止并发申请越过 20/200。`Stopping` 直到子进程
真正退出并被 reap 才释放槽位。仅从兼容查找或 LRU 删除条目不等于释放 Resident accounting。

Fleet 不新增运行中 AgentRun 数量上限，也不为 BusyBurst 设置成员级或全局数量上限；
ADR-0058 的每 Conversation 单槽和其他既有领域准入约束继续有效。BusyBurst 不占用 20/200，
只服务当前 AgentRun，Run 结束后必须关闭。Resident 满载、Burst 数量继续增长时，系统以真实
OS spawn 结果作为最终资源边界；不会因 Fleet 容量把 Run 放入
`waiting(runtime_capacity)`。spawn 失败按现有 AgentRun 启动失败与恢复语义处理。

<a id="adr-0123-5-acquire-原子选择兼容进程resident-或-burst"></a>
#### 5. acquire 原子选择兼容进程、Resident 或 Burst

每次正式 AgentRun 申请进程时，Manager 按以下顺序处理：

1. 先清理可确认不健康、已经失效或超过 TTL 的 IdleWarm；
2. 若存在三项身份完全匹配且健康的 IdleWarm，原子绑定 lease 并转为 BusyResident；
3. 若成员与全局 Resident 配额都有空位，预留 Starting 槽位并创建 BusyResident；
4. 若成员配额已满，只有该成员自己的 IdleWarm 能释放成员槽位；没有此类进程时直接创建
   BusyBurst，淘汰其他成员的进程没有意义；
5. 若全局配额已满，优先选择当前成员最久未使用的 IdleWarm，再选择全局最久未使用的
   IdleWarm；
6. 若没有适用的 IdleWarm，创建 BusyBurst。

淘汰候选在 Manager 的原子状态操作中从 IdleWarm 转为 Stopping，并立即从兼容查找与 LRU
索引移除。Manager 给 shutdown/reap 一个短且有界的期限：

- 期限内真正退出并释放槽位：预留该槽位并创建 BusyResident；
- 期限内未退出：创建 BusyBurst，旧 Stopping 进程继续接受强制清理；
- 不允许把 Stopping 当作已经释放的槽位，也不允许 BusyBurst 在稍后有空位时晋升为
  Resident。

配额检查、IdleWarm 领取、Starting 预留和 lease generation 分配必须是一个原子状态决定。
耗时 spawn/stop 在 Manager 状态锁外执行，并用 operation generation 防止完成回调提交到已经
失效的预留。

<a id="adr-0123-6-run-结束由-adapter-给出可复用结论"></a>
#### 6. Run 结束由 Adapter 给出可复用结论

Resident 只有同时满足以下条件时转为 IdleWarm：

- AgentRun 已经通过当前 execution fence 进入可接受的结束点；
- Runtime 进程仍健康；
- 没有活动 Prompt/Turn、待处理 RPC、Approval、Action 或未知投递；
- Team lease 已解绑或 fenced；
- Adapter 能证明进程已经 quiesce，且当前配置仍有效。

Adapter 不能证明任一条件时，Manager 必须关闭进程。协议错误、配置失效、Runtime 异常退出、
取消后状态不确定或输入投递结果未知都不能进入 IdleWarm。

BusyBurst 无论 Run 成功、失败或取消都进入 Stopping 并关闭。Claude Code 与 Antigravity 的
one-shot 进程在完成后自然退出；异常未退出时仍由 Manager 执行有界停止。

<a id="adr-0123-7-idle-sweeper-强制随-fleet-启动"></a>
#### 7. Idle Sweeper 强制随 Fleet 启动

默认配置为：

```text
idle_ttl = 30 minutes
sweep_interval = 60 seconds
```

构造并启动可接收 acquire 的 `AgentRuntimeFleetManager` 时必须同时启动周期性 Idle Sweeper；
不能依赖外部调用方选择是否启动。Sweeper 每轮扫描全部 IdleWarm，并把超过 `idle_ttl` 的进程
立即转为 Stopping、关闭和 reap。

TTL 使用单调时间判断，不受系统时钟回拨影响。LRU 使用单调递增的 `last_used_sequence`，不
要求真实链表。实现可以使用权威 `HashMap<ProcessId, ProcessEntry>` 与只索引 IdleWarm 的
`BTreeSet<(last_used_sequence, ProcessId)>`。

进入 Stopping 时，进程立即从兼容索引、IdleWarm 成员索引和 LRU 移除；为了保持 Stopping
仍占 20/200，它继续存在于权威进程表和 Resident accounting 中。只有 reap 完成后，才从成员
与全局 accounting 以及权威进程表删除。

周期扫描不是唯一清理入口。以下事件必须立即执行对应清理：

- 进程申请：先回收不健康、失效和过期 IdleWarm，再进行容量决定；
- Run 结束：立即执行 quiescence/健康判断并转为 IdleWarm 或 Stopping；
- Camp 删除：关闭该 Camp 的全部可复用进程；
- 成员永久移除：关闭该 `agent_profile_id` 的全部可复用进程；
- Runtime 配置、Installation、协议、投影或其他进程兼容输入变化：关闭已空闲的旧 digest
  进程。

配置变化时，正在执行的 Resident 立即失去后续复用资格并标记 `retire_after_run`，但不因容量
回收自动终止已经冻结的 AgentRun。现有取消、安全撤权和 execution fencing 规则仍可独立使
活跃能力立即失效。ADR-0057/0058 对成员永久移除和 Camp 删除的 quiescence gate 继续有效，
删除清理不能绕过这些业务约束。

<a id="adr-0123-8-idlewarm-明确保留进程级外部-mcp-状态"></a>
#### 8. IdleWarm 明确保留进程级外部 MCP 状态

Reusable Resident 可以在 IdleWarm 期间保留其精确冻结的外部 MCP 投影、Runtime 内存、必要
私有配置文件以及 Runtime 已启动的 MCP 子进程或连接，直到 TTL 到期后的下一轮 sweep、失效
事件或容量淘汰触发关闭。默认到期发现延迟不超过一个 `sweep_interval`；进入 Stopping 后不再
可复用，但凭据和子进程在 Runtime 真正退出前仍可能存在。`idle_ttl` 是开始回收的期限，不是
绝对凭据擦除时刻。产品和工程文档不得继续把这类 Resident 描述为 AgentRun 终态即销毁全部
投影凭据。

只有三项复用身份完全相同的后续 Run 可以领取该进程。空闲期间没有活跃 AgentRun lease，
所有 Team Tool `list`/`call` 都必须在当前 Run、Execution Epoch 和 lease 校验处失败关闭，稳定
表现为 `run_not_bound` 或等价无领域写入结果。外部 MCP 不经过 Core 通用 Proxy，因此其状态
保留属于明确接受的本机凭据生命周期扩张，而不是 Core 已撤销外部凭据的保证。

Adapter 能在不影响复用的前提下提前删除私有文件或停止 MCP 子进程时可以这样做；不能证明时
必须保留精确字节或关闭整个 Runtime，不能在空闲进程内重建为最新配置。Camp/成员删除、配置
失效和 TTL 回收仍必须删除 Rovai-owned 私有投影并停止可证明属于该 Runtime 的子进程。

本节局部替代 ADR-0018 对 reusable Resident 的“AgentRun 终态立即删除 Runtime-native
projection”要求。逐 AgentRun 冻结 Projection Input/Exposure、恢复使用原冻结输入、外部 MCP
真源、精确投影和 redaction 要求继续有效。

<a id="adr-0123-9-fleet-不跨-core-generation-复用"></a>
#### 9. Fleet 不跨 Core generation 复用

Fleet 的进程表、lease、IdleWarm 与 LRU 是单个 Core generation 的内存状态，不写入 SQLite，
也不在 Core 重启后重新接管。正常 Core shutdown 必须停止并 reap 全部 Resident、Burst 和仍在
运行的 one-shot 进程。

每个 Runtime 使用可单独终止的进程组，并留下最小、私有的 owner record。记录只用于崩溃后
清理，包含 Core generation token、PID、进程组身份和冻结可执行文件路径；启动清理必须同时
校验记录属于旧 generation、PID 仍是该进程组组长且当前命令身份匹配。它不是可恢复 Fleet
状态。仅凭 PID、文件路径存在或同一用户 UID 不得杀进程；平台无法提供可靠的进程身份证明时
必须保留记录并等待后续人工清理，而不能猜测性终止。

Core crash/restart 使全部旧 Team credential、Attested lease、Runtime lease 和 IdleWarm 失效。
旧进程清理后，非终态 AgentRun 通过现有 Runtime recovery 与 execution fencing 使用新进程
恢复；旧 IdleWarm 不产生任何复用权。

本节局部替代 ADR-0107 的“Codex app-server 每 AgentRun 新建且终态即关闭”条款。ADR-0107
的 `(campId, agentProfileId)` Isolated Codex Home、Home 配置所有权、Native Session 连续、
Camp 删除 cleanup record 和 orphan GC 继续有效。Codex Resident 仍不得跨 Home 复用；不同
runtime digest 的新进程启动前必须遵守 Home 的活动进程和配置写入 fencing。

<a id="adr-0123-consequences"></a>
### Consequences

- 所有正式 AgentRun 获得统一、可验证的进程独占语义，ACP 不再存在无 Team Tool 时的并行
  Host 共享特例。
- Codex 与六种 ACP Runtime 可以在兼容 Run 之间复用启动成本，同时每成员最多保留 20 个、
  全局最多保留 200 个 Resident 根进程；Runtime 后代进程不受这两个数字直接计数。
- Resident 配额不提供总并发保护。BusyBurst 无上限意味着极端并发可能耗尽内存、PID、文件
  描述符或其他 OS 资源，并最终表现为 spawn 失败；这是被明确接受的运行风险。
- Stopping 仍占槽位和有界淘汰等待会使部分申请退化为 Burst，但不会为了降低启动数而突破
  20/200。
- IdleWarm 把部分外部 MCP 凭据、进程内状态和子进程生命周期延长到默认 30 分钟 TTL 后的
  下一轮扫描，并持续到进程实际退出；精确兼容身份、Team fail-closed、及时失效清理和真实
  退出确认成为强制安全条件。
- Manager 需要可靠处理 acquire/release/cancel/config-change/sweep/shutdown 竞态，并让所有
  完成回调携带 operation 或 lease generation。
- Core crash 后不会保留 warm-start 优势；安全清理旧进程和恢复 AgentRun 优先于跨 Core
  复用。
- AgentRun 与 Native Session 仍是持久业务事实，Fleet 状态只是可丢失的进程控制状态；不新增
  SQLite Resident、IdleWarm 或 LRU 真源。

<a id="adr-0123-rejected-alternatives"></a>
### Rejected Alternatives

- **没有 Team Tool 时继续共享 ACP Host。** 这保留进程内并行多租户和路由复杂度，违反一个
  进程同一时刻只服务一个 AgentRun 的统一语义。
- **所有 Runtime 永远按 Run 新建进程。** 语义简单，但放弃兼容进程串行复用和受控常驻池的
  启动收益。
- **Fleet Manager 解析统一兼容字段。** 不同 Runtime 的进程级输入并不相同，会把 Adapter
  私有知识泄漏到 Manager 并形成不完整的跨 Runtime 超集。
- **达到 Resident 配额后阻塞或排队 AgentRun。** Resident 配额只控制可跨 Run 保留的资源；
  本决策选择无上限 BusyBurst 继续启动。
- **为 BusyBurst 增加全局硬上限。** 这会形成独立的运行并发准入合同，与“不设置运行中
  AgentRun 上限”的选择冲突。
- **IdleWarm 转为 Stopping 即释放 Resident 槽位。** 实际进程尚未退出时创建新 Resident 会让
  物理常驻数突破 20/200。
- **淘汰时无限等待退出。** 一个失效 Runtime 可以让新 Run 无限等待；短期限后使用 Burst
  保留进展。
- **BusyBurst 在空位出现后晋升 Resident。** 这会让一次 acquire 的结束策略在 Run 中途变化，
  扩大竞态并破坏 Burst 无条件关闭语义。
- **配置变化时为回收槽位终止 BusyResident。** 容量管理不能杀死正在执行的 AgentRun；旧
  进程应 retire-after-run。
- **保持 ADR-0018 的终态凭据清理并同时允许所有正式进程 IdleWarm。** Runtime 可能已经在
  内存或 MCP 子进程中持有凭据，无法同时真实保证两种语义。
- **跨 Core 重启重新接管 Resident。** 当前 stdio Host 不可重连，且旧 credential、lease 和
  generation 必须失效；实现接管需要独立 Supervisor 与新的可重连协议。

<a id="adr-0123-references"></a>
### References

- [v0.41 当前版本；本 ADR 不扩张其既有实施范围](README.md)
- [ADR-0014: Stable Team Tool Gateway v2](../v0.06/decisions.md#adr-0014)
- [ADR-0018: File-Backed MCP Library and Per-Run Runtime Projection](../v0.09/decisions.md#adr-0018)
- [ADR-0057: Member Presence and Retained Permanent Removal](../v0.15/decisions.md#adr-0057)
- [ADR-0058: Collaboration v4](../v0.15/decisions.md#adr-0058)
- [ADR-0062: Interruptible Runs and Unsettled External Effects](../v0.17/decisions.md#adr-0062)
- [ADR-0079: Two-Phase Cancellation Projection and Bounded Runtime Interrupt](../v0.24/decisions.md#adr-0079)
- [ADR-0082: Member-Owned Runtime Parameters and Explicit Configuration](../v0.26/decisions.md#adr-0082)
- [ADR-0088: Attested Native Team Gateway Attachment](../v0.30/decisions.md#adr-0088)
- [ADR-0107: Camp-Member Isolated Codex Home and AgentRun-Scoped App Server](../v0.39/decisions.md#adr-0107)
<!-- legacy-adr-body:end id=ADR-0123 -->
<!-- legacy-adr:end id=ADR-0123 -->
