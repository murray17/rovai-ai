---
document_type: adr
id: ADR-0154
title: Agent-Level Continuous Execution Process Surface
status: accepted
date: 2026-08-10
decision_scope: cross-version
source_version: v0.55
supersedes: [ADR-0133]
superseded_by: null
---

# ADR-0154: Agent-Level Continuous Execution Process Surface

## Context

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

## Decision

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

## Consequences

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

## Rejected Alternatives

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

## References

- [v0.55 version overview](../versions/v0.55/README.md)
- [ADR-0133: Scheme C Run Process Detail Surface](0133-scheme-c-run-process-detail-surface.md)
- [ADR-0084: Conversation Surface Controls and Stop Outcome Projection](0084-conversation-surface-controls-and-stop-outcome-projection.md)
- [Run Process Detail Surface v2](../contracts/run-process-detail-surface-v2.md)
- [Arctic Dawn V3](../ui/arctic-dawn.md)
