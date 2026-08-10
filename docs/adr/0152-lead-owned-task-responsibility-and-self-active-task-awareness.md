---
document_type: adr
id: ADR-0152
title: Lead-Owned Task Responsibility and Self-Active Task Awareness
status: accepted
date: 2026-08-10
decision_scope: cross-version
source_version: v0.54
supersedes: []
superseded_by: null
---

# ADR-0152: Lead-Owned Task Responsibility and Self-Active Task Awareness

## Context

Durable Task v2 allowed every eligible Agent to create Tasks, let ordinary Assignees redefine or
transfer their Tasks, exposed unassigned Tasks as a claimable queue, and limited ordinary Task reads
to self/unassigned/self-created records. In parallel Camps this let several Agents independently
persist overlapping execution-plan steps and mutate the responsibility graph. At the same time,
injecting a Camp-wide Task board into every AgentRun would create a large, stale snapshot and still
would not replace an authoritative Task read before mutation.

Rovai needs one durable responsibility authority, bounded execution-state delegation, self-relevant
Run awareness, and Camp-wide on-demand coordination reads. It also needs guidance that discourages
Task-per-step creation without turning Core into a semantic duplicate detector.

## Decision

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

`blocked` requires `blockedReason`; `completed` requires `completionSummary`; leaving `blocked`
clears the blocker. Ordinary Agents cannot cancel, return a Task to `pending`, change definition
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

## Consequences

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

## Rejected Alternatives

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

## References

- [v0.54 version overview](../versions/v0.54/README.md)
- [ADR-0136: Durable Task v2 Responsibility and Coordination Authority](0136-durable-task-v2-responsibility-and-coordination-authority.md)
- [ADR-0137: One-Time Task-Linked Responsibility Admission](0137-one-time-task-linked-responsibility-admission.md)
- [ADR-0147: Lossless Model Context Projection and Layered Delivery Evidence](0147-lossless-model-context-projection-and-layered-delivery-evidence.md)
- [Durable Task v3](../contracts/durable-task-v3.md)
- [Context Delivery Profile v3](../contracts/context-delivery-profile-v3.md)
- [ContextManifest Evidence v10](../contracts/context-manifest-evidence-v10.md)
