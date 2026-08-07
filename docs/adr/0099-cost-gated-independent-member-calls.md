---
document_type: adr
id: ADR-0099
title: Cost-Gated Independent Member Calls Without Return Semantics
status: superseded
date: 2026-08-03
decision_scope: cross-version
source_version: v0.34
supersedes: [ADR-0091]
superseded_by: ADR-0130
---

# ADR-0099: Cost-Gated Independent Member Calls Without Return Semantics

## Context

ADR-0091 made every Member Call choose `returnPolicy=none|required`. A required call created a
durable Return Obligation, reserved a second Run slot, instructed the recipient to call the source
back, and caused Core to enqueue a synthetic Call Outcome when that callback never arrived. This
made receiving a message or finishing work look like an automatic reason to communicate again.

Member-to-member communication is itself a costly collaboration action. A follow-up is useful only
when its target needs the information to continue acting or decide; acknowledgements, courtesy
replies, non-blocking progress updates, and repeated information create Runs and noise without
advancing responsibility. Rovai therefore needs durable Member Calls without a protocol-level reply
expectation or a Core-authored substitute for a message the member did not send.

## Decision

The model-controlled tool contract is:

```text
team.call_member({
  recipient: AgentProfileId,
  content: string,
  taskId?: TaskId
})
```

`returnPolicy` and every equivalent requires-reply field are absent from the input schema, parser,
durable command, receipt, Current Input, prompt, and public contract. A Member Call still requests
one recipient execution opportunity through one durable InboxMessage and one persist-first
Conversation Input; it remains neither a passive notification nor proof that a Run started or work
completed.

Every accepted Member Call is an independent forward edge. A later call to the original sender is
another ordinary call, allocates one new A2A Run slot, and increases logical A2A depth. It does not
close or satisfy the earlier call, inherit reserved capacity, or receive privileged scheduling. The
Conversation Input store has only this one active input form and therefore carries no single-value
kind discriminator.

Return Obligation and Call Outcome are removed from the domain, SQLite schema, terminal Run
transactions, Read Side, Renderer contracts, qualification evidence, and tests. Core never wakes or
messages a source merely because the recipient ended, failed, was cancelled, or did not contact the
source. Input and Run failure remain authoritative Audit/UI facts and continue to participate in
CampTurn settlement. A recipient Run's ordinary final output remains a user-facing CampMessage, but
is not routed to the source and creates no source Run.

A CampTurn settles when its accepted Conversation Inputs and AgentRuns settle. It does not wait for
the original caller or Default Lead to run again, and missing integration is not a mechanical
settlement blocker. Qualification may record each independent Call lifecycle, duplicate acceptance,
cycles, depth, latency, and budget use, but has no response-closure, explicit-return, or Core-Outcome
protocol metric. Whether another call was necessary or a result was integrated belongs to Semantic
Review and may remain indeterminate.

The Session Charter and canonical tool description impose a complete send gate:

- `call_member` is not the default action for ending current work;
- call only when the target needs the message to continue acting or make a decision;
- never call merely to acknowledge receipt, reply politely, send non-blocking progress, or repeat
  shared information;
- before calling, confirm the target will have a clear next action or is waiting for this necessary
  result.

This gate is normative model instruction, not heuristic content classification in Core. Core
continues to enforce structural schema, identity, authorization, recipient, Task, turn, depth, and
budget invariants without guessing the purpose of natural-language content.

Because the replaced protocol was not released, implementation rewrites its migration and removes
the old contract without a compatibility alias, legacy parser, or retained Return/Outcome data path.
The breaking built-in catalog increments the Attested Team Protocol version so an older Bridge
cannot claim the new schema.

This ADR preserves ADR-0091's persist-first Conversation Input, per-Conversation FIFO,
single-active-Run scheduling, crash recovery, no-polling rule, and safe accepted receipt. It replaces
all of ADR-0091's Return Policy, Return Obligation, Call Outcome, reply-depth, reserved-return-slot,
and source-resume clauses.

## Consequences

- Member communication becomes intentional and uniformly costed; a reverse route cannot bypass
  depth or Run-slot accounting.
- Call acceptance, materialization, terminalization, cancellation, Read Side, and Renderer state no
  longer coordinate an exactly-once response subsystem.
- A caller receives no synthetic lifecycle explanation as model input. Users instead rely on public
  Run output, failure presentation, Activity, Audit, and CampTurn state.
- Core cannot prove that collaboration was semantically integrated. That ambiguity is explicit and
  belongs to advisory review rather than a hidden execution obligation.
- Prompt and tool-description quality become the primary prevention for low-value calls; structural
  Core validation deliberately cannot reject them from message text.

## Rejected Alternatives

### Keep `returnPolicy=none|required` but improve the default

Rejected because the field still makes callback expectation part of every call contract and keeps
the obligation, reservation, terminal transaction, and synthetic Outcome machinery alive.

### Preserve a derived voluntary-return edge

Rejected because a call back would regain privileged depth or capacity semantics even though no
response responsibility exists. Every communication instead uses the same forward-edge accounting.

### Forward a recipient's final output or failure automatically

Rejected because final output is user-facing rather than addressed to the source, while a synthetic
failure input would still be a Core-authored substitute for member communication.

### Enforce the send gate by classifying content in Core

Rejected because acknowledgement, progress, repetition, necessity, and decision dependence cannot
be reliably established from message text without false acceptance or rejection.

## References

- [ADR-0091: Durable Member Calls and Single-Slot A2A Resume Scheduling](0091-durable-member-calls-and-single-slot-a2a-resume.md)
- [v0.32 Event-Driven Member Calls](../versions/v0.32/README.md)
