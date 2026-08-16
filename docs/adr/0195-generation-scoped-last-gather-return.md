---
document_type: adr
id: ADR-0195
title: Generation-Scoped Last Gather Return with Independent Bound
status: accepted
date: 2026-08-16
decision_scope: cross-version
source_version: v0.90
supersedes: []
superseded_by: null
---

# ADR-0195: Generation-Scoped Last Gather Return with Independent Bound

## Context

A Gather dispatch to N members already consumes N accepted A2A operations. Charging each captured return to the same
maximum prevents a full 16-member Gather from returning any explicit result. At the same time, projecting every public
return creates two correctness failures: a progress message can displace the useful terminal summary, and returns from
a failed retry generation can be mixed with the replacement generation.

Captured returns do not materialize Runs, but they remain public durable writes and therefore cannot be unbounded or
silently deleted. The completion needs one deterministic result per current Item responsibility while preserving older
messages as audit history.

## Decision

Gather capture uses an independent bound and generation-scoped last-result authority:

1. An exact captured return consumes neither the ordinary CampTurn accepted-A2A allowance nor an AgentRun
   responsibility. The ordinary CampTurn limits remain unchanged for dispatchable A2A work.
2. Core admits at most 16 captured returns for one exact GatherItem dispatch Delivery, source AgentRun and active retry
   generation. The CampTurn lifecycle and deadline remain authoritative.
3. Barrier result selection requires the Item's current target Run and active retry generation, then selects only the
   last accepted eligible public message by stable Camp sequence/order. Earlier eligible messages are progress history;
   prior-generation messages are audit-only.
4. A successful member final output is the fallback only when that current generation has no captured return. Member
   context and CLI teaching require the last explicit return to contain the complete conclusion.
5. Retry preserves all old Runs, Deliveries and CampMessages; changing active generation changes result authority
   without rewriting history.

This locally overrides ADR-0193's statement that a capture consumes accepted A2A and narrows ADR-0194's ordered
captured-result projection. Its persistent identity, terminal authority, unified Delivery and immutable Barrier
boundaries otherwise remain effective.

## Consequences

- A 16-member Gather can receive an explicit result from every member without removing the normal A2A safety cap.
- Progress is allowed, but the member must deliberately make its last return complete; terminal output cannot
  implicitly overwrite an explicit captured result.
- Completion cannot combine conclusions from a failed generation and its retry, while all public evidence remains
  inspectable.
- Capture admission needs its own atomic counter query and stable failure detail, and completion queries need exact Run
  and generation predicates.

## Rejected Alternatives

- **Remove or raise the CampTurn accepted-A2A maximum globally.** This broadens ordinary delegation and loop risk for a
  return path that cannot materialize a Run.
- **Project every captured message.** Progress noise and superseded retry generations remain ambiguous to the Lead.
- **Use the member terminal output even after a capture.** Two competing result authorities make deterministic recovery
  and user-visible intent unclear.
- **Delete old-generation captures on retry.** They are valid public and audit facts even though they no longer control
  the current completion.

## References

- [v0.90 版本目标](../versions/v0.90/README.md)
- [ADR-0193](0193-durable-gather-barrier-over-unified-message-delivery.md)
- [ADR-0194](0194-mandatory-typed-gather-completion-current-input.md)
- [Gather v2](../contracts/gather-v2.md)
- [Message Delivery v4](../contracts/message-delivery-v4.md)
