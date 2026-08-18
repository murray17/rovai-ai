---
document_type: version-decisions
version: v0.55
lifecycle: historical
last_updated: 2026-08-18
---

# v0.55 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0154](#adr-0154) | Agent-Level Continuous Execution Process Surface | `accepted` |
| [ADR-0155](#adr-0155) | Treatment-Blind Outcome and Process Judge Views | `accepted` |

<!-- legacy-adr:begin id=ADR-0154 source-file-sha256=69af214379d0df909d33a96ff7720b3137a72ef5e3ea28790044b0655e4a3ce9 -->
<a id="adr-0154"></a>

## ADR-0154: Agent-Level Continuous Execution Process Surface

迁移时原路径：`docs/adr/0154-agent-level-execution-process-surface.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0154
title: Agent-Level Continuous Execution Process Surface
status: accepted
date: 2026-08-10
decision_scope: cross-version
source_version: v0.55
supersedes: [ADR-0133]
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0154 -->
<a id="adr-0154-context"></a>
### Context

ADR-0133 made the Run Pulse and Execution Drawer the sole process-detail surface, but selected one
`AgentRun` at a time. A recurring Agent therefore produced a growing list of nearly identical
chips and required users to infer which individual Run represented that Agent's continuing work.
The Run picker also made Task related execution, stop-result navigation and header summaries point
at transient Run identities rather than the person whose work users were following. Keeping the
old Inspector Audit tab creates a second, low-context chronology beside the process surface.

The Core still owns each AgentRun, CampTurn, Message Delivery, ContextManifest, Canonical Runtime
Activity and Execution Evidence independently. A Renderer grouping must improve reading and
navigation without inventing a durable Process entity, merging evidence, changing cancellation
authority, or turning a display grouping into a scheduler or delivery contract.

<a id="adr-0154-decision"></a>
### Decision

The Camp execution surface is Agent-level. For the current Camp Snapshot, Renderer groups all and
only AgentRuns with the same `agentId` into one Agent execution process. Each Agent with at least
one Run has exactly one stable process entry. The entry is a read-model grouping: it has no Core
table, IPC command, durable ID, mutation authority, or compatibility reader. It must not infer a
process from Task, CampTurn, Delivery, adjacent time, body similarity, or any relationship other
than the same Camp and Agent ID.

Process entries are ordered for people by current CampMember order, with a stable Agent ID fallback.
The Run Pulse identifies the surface as an Agent execution console and presents one selectable
entry per Agent, with the Agent identity and a localized state from a preferred Run. It does not
present one chip per Run, an aggregate Run/Delivery count as a substitute for a person, or a
separate activity timeline. Selecting an Agent opens that Agent's process; background events never
open the Drawer, switch the selected Agent, scroll the conversation, or take focus.

The Execution Drawer remains the sole read-only process-detail surface, but its selection identity
is `agentId`. It presents the Agent's Runs in chronological order as separate stages. Every stage
retains its individual AgentRun ID, interval, CampTurn, invocation kind, A2A depth where applicable,
Run status, Delivery recipients and Execution Evidence disclosures. Message footers and Run stages
do not repeat Delivery-state tags; Delivery, ContextManifest, Canonical Runtime Activity and audit
facts retain their existing Core Read Side boundaries. No stage is merged, hidden, rewritten as
another stage, or made authoritative over a different stage.

When a user opens a process, Renderer focuses the newest `running` Run; if none is running, it
uses the newest nonterminal Run; otherwise it uses the newest terminal Run. The selected stage is
scrolled into view and only that stage may default its live disclosure open. The process remains
selected until the user closes it, chooses another Agent, or changes Camp. Closing or using Escape
from the focused process returns focus to the original process trigger. The Drawer remains a named,
non-modal region with no backdrop or focus trap.

Task Related execution and stop outcome links route to the owning Agent process rather than a Run
picker. Camp Header no longer renders an execution summary or process entry. Inspector contains only Tasks, Context Delivery and
Approvals; the old Activity and Audit tabs, their route/state/IPC/test fixtures, and any duplicate
process chronology are removed. Audit evidence remains attached to its authoritative objects and
is not copied into a new Renderer audit surface.

The Composer send position remains the only Stop control. It cancels/fences the active CampTurn's
entire AgentRun/Message Delivery tree according to the existing cancellation ADRs. Neither the
Agent process entry, Drawer, Run stage, Inspector nor public message receives Agent-level or
Run-level stop, cancel, retry, or other domain mutation. Approval Dock remains immediately above
Composer; the process surface degrades or scrolls rather than obscuring Approval, Composer, or the
unique Stop action.

This is a current-only Renderer clean break. It supersedes ADR-0133's per-Run Run Pulse/Drawer
selection and four-tab Inspector surface. It does not supersede ADR-0084's remaining conversation
control/stop projection, or the Core contracts for Runtime Activity, Evidence, Delivery and
CampTurn cancellation.

<a id="adr-0154-consequences"></a>
### Consequences

- Users follow one Agent's coherent execution history through one stable entry while retaining the
  precise Run boundaries required for evidence and recovery.
- Renderer selection state is smaller and maps Task/stop navigation to a durable Agent
  identity already present in the snapshot.
- A growing history of repeated AgentRuns does not create a growing parallel process chooser.
- Removing the Inspector audit surface eliminates duplicate, context-poor execution chronology;
  evidence remains available per Run in the Drawer and through its existing authoritative reads.
- The new UI must test grouping and preferred-stage selection independently of Core Run ordering,
  and must verify focus return, reduced motion, zoom and compact-window visibility.
- Consumers that used ADR-0133 or Run Process Detail Surface v1 as a current Renderer entry must
  use ADR-0154 and v2; v1 remains immutable historical documentation.

<a id="adr-0154-rejected-alternatives"></a>
### Rejected Alternatives

- Keep one Run Pulse chip per AgentRun and add a visual group only: the primary navigation still
  grows by transient executions and makes the user's reading target ambiguous.
- Persist a Core Process record: it would impose lifecycle, migration and recovery semantics on a
  presentation-only grouping without a new domain need.
- Merge same-Agent Runs into one synthesized evidence stream: this loses CampTurn, delivery and
  execution-boundary truth, especially around retries and A2A.
- Group by Task, CampTurn, text similarity or time window: an Agent can perform independent work
  in each of these relationships, and deterministic UI grouping must not claim semantic continuity.
- Keep Inspector Audit as a second process history: it duplicates the Drawer without the selected
  Agent's stage context and invites divergent projections.
- Add per-Agent or per-Run Stop/Cancel in the process view: it bypasses the existing CampTurn
  cancellation fence and creates partial-tree cancellation semantics.
- Auto-open or auto-switch the Drawer for new Runtime events: observing background work must not
  take the user's attention or keyboard focus.

<a id="adr-0154-references"></a>
### References

- [v0.55 version overview](README.md)
- [ADR-0133: Scheme C Run Process Detail Surface](../v0.45/decisions.md#adr-0133)
- [ADR-0084: Conversation Surface Controls and Stop Outcome Projection](../v0.26/decisions.md#adr-0084)
- [Run Process Detail Surface v2](../../contracts/run-process-detail-surface-v2.md)
- [Camp 会话工作区 UI 合同](../../ui/components/conversation-workspace.md)
<!-- legacy-adr-body:end id=ADR-0154 -->
<!-- legacy-adr:end id=ADR-0154 -->

<!-- legacy-adr:begin id=ADR-0155 source-file-sha256=bf15b6d8328f3aa7f48051c6ffea70bcc469c407f903e26b1f98d19070389c67 -->
<a id="adr-0155"></a>

## ADR-0155: Treatment-Blind Outcome and Process Judge Views

迁移时原路径：`docs/adr/0155-treatment-blind-outcome-and-process-judge-views.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0155
title: Treatment-Blind Outcome and Process Judge Views
status: accepted
date: 2026-08-11
decision_scope: cross-version
source_version: v0.55
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0155 -->
<a id="adr-0155-context"></a>
### Context

现有 Semantic Engineering Review 把工程结果和协作过程放在同一 checklist 与同一 Judge Evidence Pack 中。
它能拒绝无引用的意见，却仍让 outcome verdict 看到 Member、角色、Message Delivery 和协作消息，因此不能作为
未来 Team/Solo 对照的 treatment-blind outcome measurement；反过来，只给 Process Judge Message/Run 数又会把
活动量误当成协作质量。完整 Evidence Reference 还携带 Trial 绑定，不应成为模型输入的一部分。

<a id="adr-0155-decision"></a>
### Decision

Semantic Review 固定分成两个互不补偿的 Judge View。Process Judge View 只适用于观察到 team interaction 的
Trial，评估 delegation necessity、handoff clarity、member contribution value、feedback absorption 和 Lead
integration。其 Model-Visible Judge Pack 只允许伪名化角色、精确 Public A2A content、确定性 interaction facts，
以及判断贡献/吸收/整合所需的有界 delivered code、verification facts 和 final response。Agent、Call、Message、
Run 或 Task 数量本身不构成正面证据；没有 interaction 时全部 Process items 为 `not_applicable`，不调用 LLM。

Blinded Outcome Judge View 同时适用于 Team 与 Solo，只评估 requirements、solution fit、implementation quality、
verification adequacy、scope discipline、final-response claim accuracy 和 limitations。其模型输入只允许 disclosed
requirements、bounded delivered code、deterministic verification/workspace-change facts 和 final response，必须排除
Team/Solo/treatment 标签、Members、角色、Calls、协作消息、Runs、Trial/slot identity 和 authoritative Evidence ID。

每个 View 都使用冻结配置下的两个 tool/network/workspace-disabled Judge Replicas，Replica B 反转 checklist
presentation order。输出必须逐项引用该 item closure 内的本地 Evidence ID；本地 ID 到 Evidence Bundle Reference
的映射只保留在 audit-only artifact，不发送给模型。valid verdict 不选择性重试，不投票、不平均，不产生 view 间
或全局 collaboration score。两个 View 保留为一个 Semantic Judge View Suite，但仍不改变 Hard Outcome。

该分离只提高过程与结果的构念测量能力，不证明 Team 比 Solo 更有效。任何 collaboration uplift 或因果主张仍
必须来自另行预注册、同 Case/预算/环境的 paired counterfactual protocol。

<a id="adr-0155-consequences"></a>
### Consequences

Outcome verdict 可以在未来 Team/Solo paired trial 中使用相同的 treatment-blind Interface；Process verdict 则能
读取判断 semantic relation 所需的协作内容，而无需把 raw Runtime logs、hidden reasoning 或完整 ContextManifest
交给 LLM。审计者仍能从本地 Evidence ID 解析回权威 Evidence Reference，并重放配置、Pack、Replicas 与 Review
的绑定。

成本是每个适用 Trial 需要四次独立 Judge invocation，并产生两套 versioned Pack/Replica/Review artifacts。
Process contribution、feedback absorption 和 Lead integration 继续是 semantic inference；其 deterministic coverage
只能证明候选证据存在，不能证明因果关系。Outcome Judge 也不替代 deterministic Hard Checks。

Outcome blinding 由 closed field projection 保证结构隔离，并可用预注册 treatment canary 对 exact Requirement、code、
path 与 final response 做 contamination gate；它不宣称能从任意自然语言中可靠识别所有自我披露。未预注册且进入
delivery content 的 arm 暗示必须在未来 paired protocol 中作为 blind-eligibility 限制报告，不能让 LLM 自行忽略。

Public A2A content 按 Message identity 去重，fanout 只产生多个 interaction observation，不复制语义正文。消息投影
必须作为 immutable artifact 绑定原始 Message metadata、Delivery、Evidence Index 与 Collaboration Ledger；缺失绑定
是 `unavailable`，不是无协作。Replica 与 Review identity 还必须包含一次独立 Judge execution identity，允许复测而不
覆盖既有 artifact。

<a id="adr-0155-rejected-alternatives"></a>
### Rejected Alternatives

- 继续用一个 combined Pack 被拒绝，因为 outcome verdict 会看到 treatment/process signals，协作 verdict 也难以
  单独解释。
- 只给 Judge Message/Run/Task counts 被拒绝，因为活动量不能证明 delegation、贡献或 integration 的价值。
- 把所有 Runtime logs、ContextManifest、Tool output 或 hidden reasoning 交给 LLM 被拒绝，因为会扩大泄漏、注入和
  不可重放表面，且混淆 source authority。
- 让 Outcome Judge 看 Team/Solo 标签后“自行忽略”被拒绝，因为 blinding 必须由 Pack construction 保证。
- 生成一个 collaboration 或 combined score 被拒绝，因为不同 semantic constructs 不可相互补偿，也不能改变
  Hard Outcome。

<a id="adr-0155-references"></a>
### References

- [v0.55 overview](README.md)
- [Semantic Judge Views v1](../../contracts/semantic-judge-views-v1.md)
- [Benchmark Protocol architecture](../../architecture/benchmark-protocol.md)
- [ADR-0095](../v0.34/decisions.md#adr-0095)
- [ADR-0098](../v0.34/decisions.md#adr-0098)
- [ADR-0151](../v0.53/decisions.md#adr-0151)
<!-- legacy-adr-body:end id=ADR-0155 -->
<!-- legacy-adr:end id=ADR-0155 -->
