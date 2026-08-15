---
document_type: adr
id: ADR-0190
title: User-Placeable Agent Execution Console
status: accepted
date: 2026-08-15
decision_scope: cross-version
source_version: v0.84
supersedes: []
superseded_by: null
---

# ADR-0190: User-Placeable Agent Execution Console

## Context

ADR-0154 established one Agent-level execution process entry per Camp member and a single bottom
Execution Drawer. ADR-0160 then limited the ordinary Inspector to Tasks and Members. The bottom console
keeps execution adjacent to the conversation, but an open Drawer also reduces vertical reading space.
Some users instead need a persistent execution reading surface beside the conversation, using the same
Agent grouping and Run evidence without creating another chronology or widening the existing Inspector.

A simple duplicate Inspector view would allow the bottom and right surfaces to diverge in selection,
evidence loading, recovery actions and focus. Making the right rail permanently wider would also reduce the
primary conversation surface at the minimum supported window. The placement choice must therefore remain
a Renderer concern while all durable execution authority stays unchanged.

## Decision

The Agent execution console has one Renderer-owned placement state per mounted Camp workspace. It starts
at the bottom and may be moved by an explicit user action into the existing Inspector. The placement is not
persisted across a newly mounted Camp workspace or application restart.

In bottom placement, Inspector contains exactly Tasks and Members. The Run Pulse remains horizontal below
the conversation, and the selected process opens in the existing vertically resizable bottom detail
surface. In Inspector placement, the bottom Run Pulse and detail surface are absent; Inspector adds a third
manually activated tab named Execution. Moving to that placement reveals Inspector and activates Execution.
Moving back restores the prior Tasks or Members tab and the bottom console.

Both placements consume the same current-Camp Agent process projection, selected Agent identity, focused
Run identity, Delivery and Evidence reads. Renderer must not create a second process chronology, durable
placement record, IPC command or Core Process entity. Task related execution, stop-result navigation and
world-map process entry activate the Execution tab when placement is Inspector; background events still
must not open, switch, scroll or focus the process surface.

The bottom selector remains horizontal because it is a wide, shallow control. The Inspector selector is a
compact vertical list ordered by CampMember order, bounded to approximately four rows with internal scroll.
The existing Inspector remains 310px normally and 260px at compact width. Inspector placement does not
offer horizontal or vertical resizing; the Run detail consumes remaining height and owns its own scroll.
The bottom detail retains its pointer and keyboard height adjustment and Main Window Session height
preference.

Closing process detail leaves the placement and Agent list available. Hiding Inspector while it owns the
console changes visibility only; restoring Inspector returns to its current tab. Placement actions and
process close/Escape provide deterministic focus return to a connected counterpart control or process
trigger. Approval Dock, Composer and the unique CampTurn Stop remain outside and unobscured.

This decision locally replaces ADR-0154's bottom-only Drawer clause and ADR-0160's unconditional two-tab
Inspector clause. Their Agent-level grouping, evidence, approval, lead, stop and Core authority boundaries
remain in force.

## Consequences

- Users can trade vertical conversation space for a persistent side-by-side execution reading surface.
- The Inspector tab set is conditional: two tabs in default bottom placement, three only while it owns the
  execution console.
- The same process data needs container-aware layout and shared parent selection state; two independent
  execution components or projections are not acceptable.
- Automated acceptance must cover both directions, vertical overflow, compact Inspector width, selection
  retention, focus handoff and the unchanged bottom resize contract.
- Placement intentionally resets to bottom with a new mounted Camp workspace, avoiding another local
  preference lifecycle and migration until persistent placement is explicitly designed.

## Rejected Alternatives

- Make Inspector the permanent default: rejected because bottom adjacency remains the established default
  and avoids reducing conversation width for users who only inspect execution intermittently.
- Render both bottom and right consoles: rejected because it creates duplicate selection, loading, evidence
  and recovery surfaces for one execution truth.
- Add a new 410px resizable Sidecar: rejected because it changes the established Inspector geometry and
  harms the primary reading plane at compact widths.
- Reuse the horizontal selector in the narrow Inspector: rejected because it hides most members behind
  lateral scrolling and conflicts with the vertical Run-history reading direction.
- Persist placement immediately: rejected because persistence, cross-Camp scope and migration semantics are
  independent product decisions not required for the explicit in-workspace switch.

## References

- [v0.84 overview](../versions/v0.84/README.md)
- [ADR-0154: Agent-Level Continuous Execution Process Surface](0154-agent-level-execution-process-surface.md)
- [ADR-0160: Focused Camp Inspector and Single Approval Surface](0160-focused-camp-inspector-and-single-approval-surface.md)
- [Run Process Detail Surface v6](../contracts/run-process-detail-surface-v6.md)
- [Camp 会话工作区 UI 合同](../ui/components/conversation-workspace.md)
