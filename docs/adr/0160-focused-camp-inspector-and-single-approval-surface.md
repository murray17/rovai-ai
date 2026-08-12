---
document_type: adr
id: ADR-0160
title: Focused Camp Inspector and Single Approval Surface
status: accepted
date: 2026-08-11
decision_scope: cross-version
source_version: v0.58
supersedes: []
superseded_by: null
---

# ADR-0160: Focused Camp Inspector and Single Approval Surface

## Context

ADR-0154 removed Activity and Audit from the Camp Inspector but retained Tasks, Context Delivery and
Approvals. In ordinary collaboration, ContextManifest is execution evidence rather than a frequent
decision surface, while the Approvals tab duplicates the same pending queue and mutation already fixed
above Composer. The remaining durable collaboration fact that users need beside Tasks is the current
Camp team and its Default Lead.

Duplicating Approval in Inspector creates two navigation targets for one blocking decision and makes a
Header pending summary unexpectedly change Inspector visibility and selection. Hiding Context Delivery
must not delete ContextManifest, weaken Runtime Input Delivery evidence or move collaboration authority
into Renderer. Moving Lead must likewise reuse the existing versioned Core command rather than create a
local selection state.

## Decision

The ordinary Camp Inspector contains exactly two manually activated tabs:

```text
任务 | 队员
```

Tasks retain their existing list, detail, editing, responsibility, conflict and related-execution
contracts. The Team tab projects current CampMember facts only: active memberships whose profile is not
removed, in stable member order, with identity, team role, current presence, Agent Runtime readiness and
Default Lead identity. It is not a second member-management page and provides no identity, presence or
Runtime configuration mutation.

The Team tab contains the single Camp-local Default Lead control. It submits the existing
`camps.changeDefaultLead` command and never treats optimistic Renderer state as authoritative. Only an
active member with `profilePresence = present` and no pending leave request is eligible. Away, leaving,
left and removed members remain ineligible; away or leaving active members may remain visible so the
current collaboration relationship is not misrepresented.

ContextManifest, Context Delivery Profile, Runtime Input Delivery and their evidence remain unchanged in
Core, Snapshot and protocol contracts, but ordinary Inspector no longer projects a Context Delivery tab.
Removing that tab does not delete, merge or rewrite any evidence and does not authorize Renderer to infer
what a model received.

Approval Dock immediately above Composer is the only ordinary pending-Approval decision surface. It keeps
the authoritative queue order, Runtime-native choices, decision identity and existing Core mutation. Camp
Header and notification pending summaries only expand, scroll to and focus that Dock; they do not reveal,
open or change Inspector. Resolving one item focuses the next pending option, while resolving the last item
removes the Dock and returns focus to Composer. Collapsing the Dock changes presentation only and never
changes queue state.

This decision locally replaces ADR-0154's three-tab Inspector and duplicated Inspector Approvals clauses.
ADR-0154's Agent-level process grouping, Run-stage evidence, unique Stop and all Core authority boundaries
remain in force. Sidebar navigation, conversation reading, Agent execution process and Composer behavior
are outside this decision.

## Consequences

- The right rail distinguishes long-lived work and collaboration facts from transient blocking decisions.
- Default Lead becomes visible without exposing low-frequency ContextManifest debugging material.
- Approval has one decision surface, so Header and notification routing cannot produce divergent local
  queue state or unexpectedly alter Inspector layout.
- ContextManifest remains available to protocol, diagnostics and execution-evidence consumers even though
  it is absent from the ordinary Camp Inspector.
- Renderer and packaged-App acceptance must verify exact two-tab semantics, Lead eligibility and mutation,
  Header-to-Dock focus, Dock collapse/restore, compact width and 200% zoom.

## Rejected Alternatives

- Keep Context Delivery and Approvals as disabled or hidden legacy tabs: rejected because unused routes and
  state preserve the ambiguity and can reappear without an explicit design decision.
- Move Approval into a modal: rejected because pending permission is contextual, may be concurrent, and
  must not trap or obscure Composer and the unique Stop.
- Put Lead selection in Header or Composer: rejected because it is a durable Camp collaboration fact and
  would overload the primary reading and input surfaces.
- Remove ContextManifest from Snapshot/Core: rejected because a lower-frequency UI projection does not
  change delivery evidence or audit authority.

## References

- [v0.58 overview](../versions/v0.58/README.md)
- [ADR-0154: Agent-Level Continuous Execution Process Surface](0154-agent-level-execution-process-surface.md)
- [Run Process Detail Surface v3](../contracts/run-process-detail-surface-v3.md)
- [Camp 会话工作区 UI 合同](../ui/components/conversation-workspace.md)
