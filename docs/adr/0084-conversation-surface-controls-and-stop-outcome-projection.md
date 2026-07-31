---
document_type: adr
id: ADR-0084
title: "Conversation Surface Controls and Stop Outcome Projection"
status: accepted
date: 2026-07-31
decision_scope: cross-version
source_version: v0.26
supersedes: []
superseded_by: null
---

# ADR-0084: Conversation Surface Controls and Stop Outcome Projection

## Context

The Arctic Dawn Camp surface kept the five-tab Inspector permanently visible and rendered
terminal cancellation beside individual AgentRun content. This preserved access to evidence, but
left less room for the conversation at the minimum supported window width and made a user-issued
Stop look like a member-authored message status.

The accepted cancellation boundary already persists `CampTurn.cancelRequestedAt`, fences every
affected AgentRun, exposes terminal Turn state and records `camp_turn.cancel_requested` in the
domain event log. Renderer therefore has enough authoritative information to present one durable
Stop outcome without creating a synthetic CampMessage or another cancellation state machine.

## Decision

### Inspector visibility is a local presentation preference

The Camp Header provides one icon-only control that hides or restores the complete Inspector.
Inspector is visible by default. Renderer remembers the preference locally for the current
installation; changing it does not create a command, Camp event, message, audit entry or setting in
Core.

When hidden, Inspector leaves layout and accessibility flow completely. The conversation and
Composer use the freed width while retaining the same centered content track. Run and Approval
summaries remain in the Header. Activating a summary restores Inspector when necessary and opens
its authoritative tab.

The control is present only for an open Camp. It does not restore the removed Header Stop or
overflow menu and does not create a collapsed rail, Drawer, resizable panel or narrow-screen
navigation mode.

### Stop is one terminal CampTurn outcome in the conversation timeline

Renderer projects exactly one Stop outcome for each terminal cancelled CampTurn:

```text
你已在 {elapsed} 后停止
```

The projection is built from the authoritative Turn and event log:

- it is shown only when `status=cancelled` and `cancelRequestedAt` is present;
- its position uses the matching `camp_turn.cancel_requested` global sequence when available,
  with `cancelRequestedAt` as the stable fallback;
- elapsed time is the non-negative duration from Turn creation to cancellation request;
- it is not a CampMessage, does not consume message sequence, and is not copied into Agent input;
- a multi-Agent or A2A execution tree still produces one outcome because Stop owns the CampTurn.

ADR-0079's two-phase presentation remains intact. Before Core confirms the terminal state, every
affected non-terminal Run immediately shows “正在停止…”, loses active animation and rejects repeat
Stop. After terminal reconciliation, the persistent outcome replaces member-adjacent cancellation
labels in the conversation. Inspector Activity continues to expose each Run's authoritative
terminal state.

If any Run in the cancelled Turn has unsettled external effects, the outcome additionally displays
“结果待确认” and provides a control that opens Inspector Activity. The projection never claims that
external effects were rolled back or did not execute.

### Copy belongs to message content

User, Agent and delivered A2A message bodies remain selectable and keyboard-copyable. Their copy
control is placed below the content inside the content surface rather than in author metadata.
The icon appears on content hover or keyboard focus and reports a short “已复制” result. Copying is
a Renderer action and produces no domain or audit event.

### Shared top bar does not replace page content

Member and Memory primary pages use the same 50px draggable top bar as Camp so their title,
navigation selection and macOS window drag surface remain consistent. Interactive controls stay
inside `no-drag` regions. Their existing production workbenches remain authoritative; prototype
member, memory and responsive-sidebar demo content is not adopted.

## Consequences

- Conversation reading width is user-controlled without losing Inspector evidence or tab state.
- Stop is clearly attributed to the user and remains reproducible after reload from existing
  authoritative facts.
- Renderer gains one mixed timeline projection, a local Inspector preference and Header-to-tab
  routing, but Core and snapshot schema do not change.
- Tests must cover ordering, one-per-Turn projection, unsettled-effect disclosure, accessible
  controls and Inspector-hidden layout.

## Rejected Alternatives

- Keep Inspector permanently visible at every supported width.
- Retain a narrow collapsed Inspector rail or convert Inspector into a Drawer.
- Store Inspector visibility in Core or emit it into Camp audit.
- Create a synthetic system CampMessage for Stop.
- Show one Stop outcome per AgentRun.
- Remove the immediate “正在停止…” phase before Core confirms fencing.
- Keep terminal cancellation text beside every member message as well as the Turn outcome.
- Replace the current Member or Memory workbench with prototype demonstration data.

## References

- [ADR-0062: Interruptible Run Trees and Unsettled External Effects](0062-interruptible-runs-and-unsettled-external-effects.md)
- [ADR-0077: Responsive CampTurn Cancellation Boundary](0077-responsive-camp-turn-cancellation-boundary.md)
- [ADR-0079: Two-Phase Cancellation Projection and Bounded Runtime Interrupt](0079-two-phase-cancellation-projection-and-bounded-runtime-interrupt.md)
- [v0.26 Member Runtime Parameters](../versions/v0.26/README.md)
