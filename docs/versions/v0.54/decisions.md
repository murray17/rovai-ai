---
document_type: version-decisions
version: v0.54
lifecycle: historical
last_updated: 2026-08-18
---

# v0.54 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0152](#adr-0152) | Lead-Owned Task Responsibility and Self-Active Task Awareness | `accepted` |
| [ADR-0153](#adr-0153) | Explicit Empty Self-Active Task Snapshot | `accepted` |

<!-- legacy-adr:begin id=ADR-0152 source-file-sha256=b07fc80269f0afe15935df0c260bfb39f2bd86f4968eef28a8186dab1e25bc5f -->
<a id="adr-0152"></a>

## ADR-0152: Lead-Owned Task Responsibility and Self-Active Task Awareness

迁移时原路径：`docs/adr/0152-lead-owned-task-responsibility-and-self-active-task-awareness.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0152
title: Lead-Owned Task Responsibility and Self-Active Task Awareness
status: accepted
date: 2026-08-10
decision_scope: cross-version
source_version: v0.54
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0152 -->
<a id="adr-0152-context"></a>
### Context

Durable Task v2 allowed every eligible Agent to create Tasks, let ordinary Assignees redefine or
transfer their Tasks, exposed unassigned Tasks as a claimable queue, and limited ordinary Task reads
to self/unassigned/self-created records. In parallel Camps this let several Agents independently
persist overlapping execution-plan steps and mutate the responsibility graph. At the same time,
injecting a Camp-wide Task board into every AgentRun would create a large, stale snapshot and still
would not replace an authoritative Task read before mutation.

Rovai needs one durable responsibility authority, bounded execution-state delegation, self-relevant
Run awareness, and Camp-wide on-demand coordination reads. It also needs guidance that discourages
Task-per-step creation without turning Core into a semantic duplicate detector.

<a id="adr-0152-decision"></a>
### Decision

The User and current Camp Default Lead own Task creation and responsibility definition. An Agent
create request is authorized from the current persisted Default Lead at invocation time; static
catalog visibility is not authorization. Normal creation requires an explicit Current CampMember
Assignee. Title, description, Acceptance Criteria, assignment, release, reassignment, return to
`pending`, and cancellation remain User/Lead authority.

An ordinary current Assignee may update only its own execution state through the existing atomic
Task update operation. Its allowed transitions are:

```text
pending     -> in_progress | blocked | completed
in_progress -> blocked | completed
blocked     -> in_progress | completed
```

`blocked` requires `blockedReason`; `completed` requires a non-null `assigneeAgentId` and
`completionSummary`; leaving `blocked` clears the blocker. Ordinary Agents cannot cancel, return a Task to `pending`, change definition
fields, assign, release, reassign, or mutate another member's Task. Terminal Tasks remain immutable.
Any unauthorized field in an otherwise readable update rejects the whole patch.

Unassigned Task remains only as a User/Lead holding state or membership-ending recovery state. It
must be `pending`, is not claimable, and cannot progress, block, or complete until User/Lead assigns
an owner. Every current fenced Camp Agent may list compact summaries and get complete current
details for every Task in that Camp; this read scope grants no write authority. `availableActions`
is advisory capability metadata only. Core authorization and field-level mutation rules are
authoritative.

Every direct or A2A AgentRun independently materializes an optional `[SELF_ACTIVE_TASKS]` section
for the target Agent's assigned `pending`, `in_progress`, and `blocked` Tasks. Default Lead receives
the same self-only projection. Selection is bounded to eight Tasks ordered by `updatedAt DESC,
taskId DESC`. Compact JSON exposes only canonical `taskId`, `title`, and `status`, plus
`omittedCount` when selection or Runtime payload budget excludes candidates. Empty projections are
omitted. Optional public history yields before Task entries; if necessary, Task entries are removed
from the selection tail and the section may be omitted rather than fail materialization.

Context Delivery Profile v3 owns Task candidate selection, ordering, limit, and budget priority.
AgentRun Context Formatter v12 owns the section name and compact model JSON. ContextManifest v10
freezes machine-only inclusion, ordered selected `{taskId, version, updatedAt}` references, optional
omission count, and exact projection digest. There is no Task watermark, delta, or accepted-ACK
state; recovery reuses the original Manifest bytes.

Session Charter contains only the stable authority fact:

> Task responsibility definition belongs to the User or current Camp Default Lead; other Agents
> execute assigned Tasks.

Creation restraint and operation details belong to command-local contracts/help. The create
contract directs User/Lead to create only durable, explicitly owned responsibilities that survive
AgentRuns or handoffs and can independently complete, block, or transfer; it directs them to prefer
advancing existing Tasks and not persist analysis, consultation, one-off review, tool operations,
local plans, A2A requests, or steps inside another Task. Core continues to enforce deterministic
authority, shape, state, version, and capacity rules only; it does not infer semantic duplication.

v0.54 adopts Durable Task v3, Built-in Tool Transport v5, Context Delivery Profile v3, Context
Formatter v12, and ContextManifest v10 as a current-only clean break. No dual reader, nullable
compatibility shim, legacy parser, or fallback projection is retained.

This decision locally replaces ADR-0136's ordinary-Agent create, responsibility-definition,
claim, and restricted-read clauses, and ADR-0067's removal of all Task awareness from AgentRun
Dynamic Context. Their other accepted boundaries remain in force, including Task-linked historical
admission from ADR-0137 and the separation of Task lifecycle from execution cancellation.

<a id="adr-0152-consequences"></a>
### Consequences

- Parallel Agents cannot independently expand the durable responsibility graph; one Lead/User
  authority owns its definition.
- Assignees can report real execution progress without gaining coordination authority.
- Camp-wide reads preserve collaboration awareness while Dynamic Context remains self-relevant and
  bounded.
- Agents must use `task get` before mutation when they need complete current content and version;
  the Run projection is intentionally non-authoritative.
- Unassigned work requires explicit User/Lead disposition instead of implicit volunteer claiming.
- Static catalog/help may describe an operation that a caller cannot invoke; Core remains the
  security boundary.
- Context and transport version changes require a clean migration that preserves business history
  but discards incompatible technical Context/Delivery evidence.
- Creation quality remains a Lead behavior and contract concern; numeric capacity limits remain
  safety caps rather than recommended creation quotas.

<a id="adr-0152-rejected-alternatives"></a>
### Rejected Alternatives

- Let every Agent create and use semantic duplicate detection: duplicate meaning is contextual and
  would turn Core into an unreliable planning judge.
- Keep a claimable unassigned queue: this recreates distributed responsibility-definition races.
- Give Assignees content, transfer, release, or cancellation authority: execution ownership would
  again mutate the responsibility graph.
- Inject the Camp-wide board or a Lead-wide exception into every Run: this increases stale context
  and makes Lead context grow with team activity.
- Emit Task deltas or maintain a Task ACK watermark: Task awareness is small, self-only, and must
  not acquire a second freshness protocol.
- Put creation restraint in Session Charter: non-Lead Agents would repeatedly receive operation
  guidance that is irrelevant to their authority.
- Create actor-specific Built-in catalogs: catalog identity would become coupled to mutable Lead
  role and Native Binding compatibility while still requiring Core authorization.

<a id="adr-0152-references"></a>
### References

- [v0.54 version overview](README.md)
- [ADR-0136: Durable Task v2 Responsibility and Coordination Authority](../v0.47/decisions.md#adr-0136)
- [ADR-0137: One-Time Task-Linked Responsibility Admission](../v0.47/decisions.md#adr-0137)
- [ADR-0147: Lossless Model Context Projection and Layered Delivery Evidence](../v0.50/decisions.md#adr-0147)
- [Durable Task v3](../../contracts/durable-task-v3.md)
- [Context Delivery Profile v3](../../contracts/context-delivery-profile-v3.md)
- [ContextManifest Evidence v10](../../contracts/context-manifest-evidence-v10.md)
<!-- legacy-adr-body:end id=ADR-0152 -->
<!-- legacy-adr:end id=ADR-0152 -->

<!-- legacy-adr:begin id=ADR-0153 source-file-sha256=bcfffae0c23b3932254ee601004714fa205acd68716053972c172f8727523474 -->
<a id="adr-0153"></a>

## ADR-0153: Explicit Empty Self-Active Task Snapshot

迁移时原路径：`docs/adr/0153-explicit-empty-self-active-task-snapshot.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0153
title: Explicit Empty Self-Active Task Snapshot
status: accepted
date: 2026-08-10
decision_scope: cross-version
source_version: v0.54
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0153 -->
<a id="adr-0153-context"></a>
### Context

ADR-0152 required every direct or A2A AgentRun to reselect self-active Tasks, but omitted the
`SELF_ACTIVE_TASKS` section whenever the selected set was empty. In a reused Native Session, a prior
Run may have projected active Tasks that are terminal before the next Run. Section absence then fails
to distinguish a current authoritative empty awareness snapshot from a projection that was omitted
because Runtime payload budget could not retain any Task entry.

<a id="adr-0153-decision"></a>
### Decision

A direct or A2A AgentRun with no self-active Task candidates must render this exact compact snapshot:

```text
[SELF_ACTIVE_TASKS]
{"tasks":[]}
[/SELF_ACTIVE_TASKS]
```

It is a complete current awareness fact for that Run. ContextManifest Evidence records
`included:true`, an empty `selectedTaskRefs` array, no `omittedCount`, and the digest of the exact
`{"tasks":[]}` projection.

Whole-section omission is reserved for a different state: self-active candidates existed, Runtime
payload budget removed every selected entry after optional public history yielded, and at least one
candidate is therefore counted in `omittedCount`. Evidence then records `included:false`, empty
`selectedTaskRefs`, positive `omittedCount`, and no projection digest. Section absence alone never
means that the current self-active set is empty.

Context Delivery Profile v3 remains current because candidate selection, ordering, limit and budget
priority do not change. The model-visible byte change creates AgentRun Context Formatter v13, and the
new inclusion/evidence meaning creates ContextManifest Evidence v11. Migration 71 discards
incompatible technical Context/Delivery evidence and fences non-terminal execution; it preserves
Camp, Task, Message and other business history and retains no v10/v11 or v12/v13 dual reader.

This decision locally replaces only ADR-0152's rule that true empty projections are omitted. All
other Task authority, self-only selection, budget, on-demand read and non-authoritative awareness
boundaries remain in force.

<a id="adr-0153-consequences"></a>
### Consequences

- Completing or losing assignment of an Agent's final active Task produces an explicit clearing
  snapshot on the next Run in the same Native Session.
- Models and diagnostics can distinguish `no current Tasks` from `Task awareness unavailable because
  of payload budget` without a watermark, delta or ACK protocol.
- The small empty section becomes required Dynamic Context; if required content plus this snapshot
  exceeds the Runtime gate, materialization fails rather than silently reclassifying true emptiness
  as budget omission.

<a id="adr-0153-rejected-alternatives"></a>
### Rejected Alternatives

- Define missing section as empty: Native Session history and payload-budget omission would remain
  ambiguous, and the clearing fact would not be present in model-visible bytes.
- Always emit `{"tasks":[]}` after budget eviction: it would falsely claim a complete empty source set
  when active Tasks existed but were omitted.
- Add a Task freshness watermark or delta ACK: the bounded per-Run full snapshot remains sufficient
  once true emptiness is explicit.

<a id="adr-0153-references"></a>
### References

- [ADR-0152](decisions.md#adr-0152)
- [Context Delivery Profile v3](../../contracts/context-delivery-profile-v3.md)
- [ContextManifest Evidence v11](../../contracts/context-manifest-evidence-v11.md)
- [v0.54 implementation plan](implementation-plan.md)
<!-- legacy-adr-body:end id=ADR-0153 -->
<!-- legacy-adr:end id=ADR-0153 -->
