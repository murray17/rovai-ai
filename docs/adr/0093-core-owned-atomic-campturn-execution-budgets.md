---
document_type: adr
id: ADR-0093
title: Core-Owned Atomic CampTurn Execution Budgets
status: accepted
date: 2026-08-03
decision_scope: cross-version
source_version: v0.34
supersedes: []
superseded_by: null
---

# ADR-0093: Core-Owned Atomic CampTurn Execution Budgets

> [ADR-0099](0099-cost-gated-independent-member-calls.md) replaces only this ADR's return-slot
> reservation clauses. Every accepted Member Call now allocates exactly one A2A Run slot; the
> remaining atomic budget authority continues unchanged.

## Context

The Qualification Runner currently observes Camp Snapshots periodically and requests cancellation
after counts exceed a Case budget. Observation cannot reject an admission transaction. Concurrent
Member Calls can both commit before the next Snapshot, and a Core restart can accidentally extend an
elapsed allowance if time is represented only by one process's timer.

Benchmark-only counters inside the Runner therefore cannot establish a strict execution budget.
Moving Qualification entities into Core would violate the existing boundary that Trial, Case, and
qualification outcome belong to the external evaluation domain. Rovai needs a general CampTurn
execution-safety contract that the formal Runner can configure without teaching Core about a
Benchmark.

## Decision

The public initial execution dispatch MAY supply a `CampTurn Execution Budget`. Core freezes the
effective budget in the same transaction that admits the CampTurn and its root AgentRun. Ordinary
product execution uses Core defaults. A requested value cannot weaken a stricter product safety
maximum.

The frozen budget contains these independent ceilings:

- elapsed time, represented by dispatch `acceptedAt` and an absolute `deadlineAt`;
- total AgentRun responsibility, counting the root Run plus one future A2A Run slot for every
  accepted Member Call;
- accepted A2A, counting only new canonical Member Call acceptance receipts.

AgentRun capacity is allocated before responsibility is accepted. Every Member Call counts exactly
one callee Run slot. A later call in any direction is another independent acceptance and consumes
another slot. Materialization, dispatch, Runtime retry, or Core restart does not count the same
accepted responsibility again.

Core first authenticates the caller and validates the command/idempotency envelope, then resolves the
canonical idempotency identity. A same-actor, same-payload replay of an accepted command returns its
original receipt even if the Turn was later fenced, without revalidating current capacity, consuming
capacity, or creating another effect. An identity collision remains an error. Only a novel request
continues through schema, target, current fence, and authorization validation before Core evaluates
the frozen budget. Invalid and unauthorized requests remain ordinary Tool denials. Only a novel
request that would otherwise be accepted can exhaust a count budget.

Such a request atomically records `Budget Exhaustion`, rejects the new responsibility without an
InboxMessage, Conversation Input, AgentRun, or other partial business side effect,
and fences the CampTurn against further execution. Budget Exhaustion is a terminal valid execution
failure; later delivery success cannot recover qualification within that Trial.

Core uses a monotonic timer while the original process remains alive. The persisted absolute
deadline is authoritative across Core recovery and never resets. When the deadline is reached, Core
records Budget Exhaustion and fences new Runs, Tool mutations, and recovery execution. A separate,
bounded termination-and-evidence grace period may stop processes and capture facts but cannot change
the budget result.

The Qualification Runner supplies the Case projection through the public dispatch contract and uses
the same frozen deadline as an independent watchdog. A material disagreement between Core and Runner
deadline observations, or a system-clock discontinuity outside the frozen tolerance, is evaluation
integrity loss rather than a selectable outcome; the Trial becomes Evaluation Pending.

Core emits authoritative budget configuration, allocation, acceptance, exhaustion, fencing, and
terminal facts. Runner snapshots remain evidence consumers and watchdogs, not admission authority.

This decision refines ADR-0099's fixed A2A Run-slot safety maximum with a frozen per-CampTurn
effective budget. It does not add Trial, Case, verifier, Pass Rate, or qualification status to Core.

## Consequences

- Concurrent Agent activity cannot commit responsibility beyond the effective budget.
- Formal Qualification and ordinary product safety share one atomic execution contract without
  sharing Benchmark outcome state.
- CampTurn persistence, initial dispatch, Member Call admission, recovery, scheduling, termination,
  Read Side evidence, and public contracts all require coordinated changes.
- Every accepted Member Call consumes one prospective slot, making budget use conservative and
  deterministic even when the eventual Run is cancelled before materialization.
- Core restart cannot create extra execution time, while clock disagreement fails evaluation closed
  instead of choosing the more favorable observer.
- An Agent cannot recover inside the same Trial after first attempting an otherwise valid operation
  beyond the frozen budget.

## Rejected Alternatives

- **Let the Runner stop a Trial after observing excess.** Rejected because periodic observation is
  not atomic with concurrent Core acceptance.
- **Keep a separate Benchmark quota implementation in Core.** Rejected because qualification entities
  and outcomes do not belong to the product execution domain.
- **Reject an over-budget Tool call but let the Turn continue.** Rejected because that treats the
  budget as side-effect capacity rather than a qualification constraint and permits unbounded denied
  attempts.
- **Count actual materialized Runs instead of accepted responsibility.** Rejected because pending
  accepted Inputs could overcommit future execution.
- **Reset elapsed time after Core restart.** Rejected because product recovery would silently grant a
  different Case budget.

## References

- [ADR-0090: Team Delivery Qualification Evidence Boundary](0090-team-delivery-qualification-evidence-boundary.md)
- [ADR-0091: Durable Member Calls and Single-Slot A2A Resume Scheduling](0091-durable-member-calls-and-single-slot-a2a-resume.md)
- [ADR-0092: Recoverable Qualification Evaluation Integrity](0092-recoverable-qualification-evaluation-integrity.md)
- [ADR-0099: Cost-Gated Independent Member Calls Without Return Semantics](0099-cost-gated-independent-member-calls.md)
- [Qualification Runner](../../scripts/qualification-runner.mjs)
