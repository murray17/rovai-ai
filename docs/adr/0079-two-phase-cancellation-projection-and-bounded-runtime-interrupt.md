---
document_type: adr
id: ADR-0079
title: "Two-Phase Cancellation Projection and Bounded Runtime Interrupt"
status: accepted
date: 2026-07-31
decision_scope: cross-version
source_version: v0.24
supersedes: []
superseded_by: null
---

# ADR-0079: Two-Phase Cancellation Projection and Bounded Runtime Interrupt

## Context

ADR-0077 moved cancellation persistence ahead of Runtime interrupt and ending Git observation.
Renderer therefore acknowledged a stop request quickly, but only the Composer Stop button
projected the local `cancelling` phase. AgentRun cards and Activity still rendered the previous
Snapshot as running, including active emphasis and progress animation.

The cancellation coordinator also awaited each Runtime interrupt serially. Codex interrupt used
the ordinary RPC response timeout, so one slow Runtime could delay its terminal cancellation and
the interrupt of unrelated AgentRuns.

## Decision

Cancellation has two user-visible and operationally distinct phases:

1. On click, Renderer derives the affected AgentRuns from the locally cancelling CampTurn IDs.
   Every non-terminal Run in those Turns immediately renders “正在停止…”, stops running animation
   and emphasis, and disables repeat Stop.
2. The Composer draft remains editable, but no new Turn can be submitted while either an
   authoritative active Run or local cancellation state remains.
3. Core persists `cancel_requested_at` and its execution fence before returning the Stop request
   ACK. Renderer does not claim the Run is terminal at this point.
4. The cancellation coordinator starts all candidate Runtime interrupts concurrently.
5. Runtime interrupt uses a cancellation-specific short deadline instead of the ordinary request
   timeout. A timeout or transport failure triggers Runtime detach/route fencing with its own
   bounded deadline; the persisted version and cancellation fence remain authoritative if detach
   cannot complete synchronously.
6. After native interrupt confirmation, process absence, or reliable logical fencing, Core
   persists `cancelled` and emits `agent_run.cancelled`. Renderer refreshes the active Camp
   Snapshot and replaces local “正在停止…” with the authoritative terminal presentation.
7. Ending Git observation is launched only after the cancellation event and cannot occupy the
   coordinator's cancellation path.

Periodic scanning remains the durable recovery path for a missed Notify or interrupted
coordinator.

## Consequences

- The whole Run surface responds immediately without falsely claiming “已停止”.
- A slow Runtime cannot serialize cancellation of other AgentRuns.
- Ordinary Runtime RPC deadlines no longer determine Stop latency.
- A cancelled Run may retain unsettled external-effect evidence when only fencing, rather than a
  native stop confirmation, was possible.
- Draft editing is independent from execution admission; editing remains available while sending
  is fenced.

## Rejected Alternatives

- Show `cancelled` optimistically: Renderer cannot prove that native execution rights ended.
- Change only the Stop button: conflicting running cards make the request appear ineffective.
- Disable the whole Composer: stopping execution does not require discarding or freezing draft
  preparation.
- Wait indefinitely for Runtime confirmation: this lets one provider control product Stop
  responsiveness and blocks multi-Agent cancellation.
- Run Git observation before the event: evidence collection is not an execution fence.

## References

- [ADR-0062: Interruptible Run Trees and Unsettled External Effects](0062-interruptible-runs-and-unsettled-external-effects.md)
- [ADR-0077: Responsive CampTurn Cancellation Boundary](0077-responsive-camp-turn-cancellation-boundary.md)
- [v0.24 Arctic Dawn V3](../versions/v0.24/README.md)
