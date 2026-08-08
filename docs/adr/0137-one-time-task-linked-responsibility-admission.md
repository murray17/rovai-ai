---
document_type: adr
id: ADR-0137
title: One-Time Task-Linked Responsibility Admission
status: accepted
date: 2026-08-08
decision_scope: cross-version
source_version: v0.47
supersedes: []
superseded_by: null
---

# ADR-0137: One-Time Task-Linked Responsibility Admission

## Context

Task-linked execution needs a clear temporal authority boundary. A Task must be eligible and assigned to
the intended recipient when new work is accepted, but a later Task update must not retroactively revoke
an already accepted Message Delivery or AgentRun responsibility. Rechecking the current Task at queued
Run dispatch would turn Task into a continuous execution fence: reassignment, blocking, completion, or
cancellation could silently fail work that Core already durably accepted.

That behavior would also conflate two distinct cancellation domains. Task Cancellation ends a durable
responsibility record; Message Delivery, AgentRun, and CampTurn cancellation control accepted execution
and have their own safety, recovery, and audit contracts.

## Decision

### 1. Admit Task linkage exactly once

Direct and A2A linkage have distinct atomic acceptance boundaries:

- **Direct linked execution:** admission occurs in the transaction that creates the linked queued
  AgentRun.
- **A2A linked execution:** admission occurs in the transaction that persistently accepts the
  Message Delivery responsibility.

At that boundary, the Task must be `pending` or `in_progress`, the target recipient must be its current
Executable Assignee, and the Camp/link identity must be valid. Acceptance freezes at least
`taskVersionAtAdmission` and `assigneeAgentIdAtAdmission` on the accepted responsibility as audit facts.
It does not freeze Task title, description, Acceptance Criteria, status text, or another full Task
snapshot; the message, purpose, expected output, and existing execution contracts carry the actual work
instruction.

### 2. Grandfather every accepted responsibility against later Task changes

Once the responsibility is accepted, later Task state or content changes alone cannot fail, cancel,
retarget, or stop materialization of its Message Delivery, queued AgentRun, or running AgentRun. This
includes:

- transition to `blocked`, `completed`, or `cancelled`;
- reassignment or release to the unassigned pool;
- title, description, or Acceptance Criteria edits.

Dispatch and AgentRun start must not recheck either `recipient == current Task assignee` or current Task
status. The Task identity and admission facts remain historical audit context. If a coordinator no longer
wants the accepted recipient to execute, the coordinator must use the explicit Delivery, AgentRun, or
CampTurn cancellation boundary.

### 3. Keep independent execution admission current

Grandfathering applies only to later Task facts. Dispatch/start still revalidates the execution system's
own current conditions, including Current CampMembership, Member Presence required for execution,
Runtime readiness, cancellation, CampTurn budget, scheduler/lease fencing, A2A lineage/capacity, and
permission or safety constraints. Those conditions may independently wait, fail, or cancel without
claiming that the Task revoked the accepted responsibility.

`blocked`, `completed`, and `cancelled` therefore prevent only a new Task-linked responsibility from
being accepted. They do not revoke an existing one. A Task may truthfully be `completed` while a
previously accepted linked AgentRun remains `running`; Renderer must present these as separate facts.
An accepted Delivery that has not yet materialized an AgentRun may still stop after its recipient is
permanently removed because Current CampMembership and Presence are independent current execution
conditions. That outcome does not weaken Task grandfathering: identity removal, not Task mutation,
causes the stop.

### 4. Locally replace continuous Task execution checks

This ADR locally replaces any ADR-0058 or implementation rule that treats the current Task as a
dispatch-time or Runtime-start execution gate after responsibility acceptance. It does not change
Message Delivery's recipient-scoped recovery, Runtime admission, or explicit cancellation contracts.

## Consequences

- Accepted work remains durable across Task coordination changes and restart/recovery.
- Task history can explain the admission version and Assignee without pretending to freeze the work
  instruction or mutable responsibility content.
- Dispatch and Runtime code must remove Task status/Assignee requalification after acceptance while
  retaining all independent execution safety checks.
- Coordination that intends to stop work requires an explicit execution cancellation, which produces a
  separate auditable fact rather than a hidden Task side effect.
- Renderer may show a terminal Task beside a non-terminal related Run and must not collapse them into one
  synthetic state.

## Rejected Alternatives

- **Continuously require the Task to remain executable.** This lets later coordination updates silently
  revoke durable accepted work and creates race-dependent behavior.
- **Retarget accepted work to the latest Assignee.** It rewrites recipient identity and violates Message
  Delivery responsibility and idempotency.
- **Cancel accepted execution when Task is cancelled.** It conflates responsibility termination with
  execution cancellation and bypasses existing cancellation safety boundaries.
- **Freeze the full Task snapshot as the execution instruction.** Task content is collaboration state;
  message/purpose/expected-output contracts already own the instruction and should not be duplicated.

## References

- [v0.47 version overview](../versions/v0.47/README.md)
- [Durable Task v2 contract](../contracts/durable-task-v2.md)
- [Message Delivery v1](../contracts/message-delivery-v1.md)
- [Camp Message Send v2](../contracts/camp-message-send-v2.md)
- [ADR-0130: Public A2A Messages and Unified Message Delivery](0130-public-a2a-message-and-unified-delivery.md)
- [ADR-0131: Recipient-Scoped Event-Driven Delivery Recovery](0131-recipient-scoped-event-driven-delivery-recovery.md)
- [Rovai-ai domain language](../../CONTEXT.md)
