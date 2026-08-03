---
document_type: adr
id: ADR-0077
title: "Responsive CampTurn Cancellation Boundary"
status: accepted
date: 2026-07-30
decision_scope: cross-version
source_version: v0.24
supersedes: []
superseded_by: null
---

# ADR-0077: Responsive CampTurn Cancellation Boundary

> [ADR-0091](0091-durable-member-calls-and-single-slot-a2a-resume.md) 将同一 Stop fence 扩展到
> pending ConversationInput 与 open ReturnObligation，并禁止 Stop 后生成 Resume Run 或
> Call Outcome。本文其余 Runtime interrupt 与迟到事件 fencing 继续有效。

## Context

ADR-0062 separates RovAI execution cancellation from reconciliation of uncertain external effects,
but the implementation still placed unrelated work on the user-visible stop path. Renderer waited
for Navigation and Camp reloads after the cancellation request, the cancellation coordinator woke
only on periodic polling, and ending Git observation was collected before an AgentRun could be
marked `cancelled` and announced to Renderer.

Those waits did not make cancellation safer. The authoritative safety boundary is the persisted
cancellation request and execution fence. Navigation refresh and Git observation are projections
and evidence collection that can follow asynchronously.

## Decision

When the user explicitly stops an active CampTurn:

1. Renderer immediately records the affected Turn IDs in local `cancelling` state and displays
   “正在停止…”. This state does not globally disable unrelated UI.
2. `campTurns.cancel` performs only the short authoritative transaction that records the
   cancellation request and advances the execution fence, then returns its ACK. It does not wait
   for Runtime interrupt, Navigation reload, Camp activation, or Git inspection.
3. A successful request notifies the cancellation coordinator immediately. Periodic scanning
   remains a recovery fallback rather than the normal wake-up path.
4. The coordinator sends the Runtime-native interrupt or confirms that no live process remains,
   then marks the AgentRun `cancelled`.
5. Core emits `agent_run.cancelled` immediately after that transaction. Renderer responds by
   refreshing the active Camp Snapshot once and reconciles local `cancelling` state against the
   authoritative terminal Turn.
6. Ending Git observation is collected and recorded after the cancellation event. It remains
   AgentRun evidence, but cannot delay cancellation status, Composer recovery, or the event sent
   to Renderer.

Event subscription polling and the scheduler interval remain recovery mechanisms for lost UI
events, process restart, or a missed notification.

## Consequences

- Clicking Stop produces immediate feedback and the request ACK is independent of Runtime and Git
  latency.
- Runtime interrupt remains authoritative work performed by Core; Renderer never invents a
  terminal cancellation.
- The Composer stays in “正在停止…” until a terminal Snapshot arrives, while navigation and other
  UI remain usable.
- A cancelled Run can temporarily have no ending Git observation. The background observer appends
  it later as a separately persisted event.
- Cancellation recovery remains durable because SQLite state, not Renderer state or Notify, is
  the source of truth.

## Rejected Alternatives

- Reload Navigation and reactivate the Camp before resolving Stop: projection I/O makes the user
  wait without strengthening the fence.
- Wait for Git observation before writing `cancelled`: repository inspection is evidence, not a
  cancellation prerequisite.
- Use only local optimistic terminal state: Renderer cannot prove that Runtime execution rights
  have ended.
- Remove periodic cancellation scanning: Notify is not durable across process failure and cannot
  replace recovery from persisted cancellation requests.

## References

- [ADR-0062: Interruptible Run Trees and Unsettled External Effects](0062-interruptible-runs-and-unsettled-external-effects.md)
- [ADR-0076: Message-First AgentRun Dispatch Boundary](0076-message-first-agent-run-dispatch-boundary.md)
- [v0.24 Arctic Dawn V3](../versions/v0.24/README.md)
