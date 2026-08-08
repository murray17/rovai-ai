---
document_type: adr
id: ADR-0136
title: Durable Task v2 Responsibility and Coordination Authority
status: accepted
date: 2026-08-08
decision_scope: cross-version
source_version: v0.47
supersedes: []
superseded_by: null
---

# ADR-0136: Durable Task v2 Responsibility and Coordination Authority

## Context

Rovai's lightweight Task records responsibility without starting Agent work, but the four-state model
cannot represent a durable blocker, ordered acceptance conditions, or an auditable explanation for
completion and cancellation. Its long-term documents also disagree with the current implementation:
ADR-0058 says the Default Lead is a Camp-wide Task reader without write authority, while the production
handler already lets the Lead update every non-terminal Task.

The stronger model must remain a responsibility record rather than becoming a workflow engine. It must
also distinguish a Camp membership ending from temporary global Member Presence, and distinguish ending
the responsibility itself from cancelling execution already accepted against that responsibility.

## Decision

### 1. Keep responsibility, notification, and execution separate

The three authoritative layers are:

```text
Task             durable responsibility, scope, assignee, and business state
camp.message.send notification and explicit public A2A delegation
AgentRun          execution lifecycle and runtime evidence
```

Creating, assigning, claiming, blocking, completing, cancelling, or otherwise updating a Task never
implicitly creates a message, Message Delivery, AgentRun, Wake, or execution cancellation. Message or
AgentRun outcome never infers a Task transition. Task carries no Runtime permission, budget, sandbox,
priority, deadline, dependency graph, progress percentage, or arbitrary evidence/result container.

### 2. Adopt the five-state Durable Task v2 lifecycle

Task state is the closed set:

```text
pending | in_progress | blocked | completed | cancelled
```

Every non-terminal state may remain unchanged or move directly to any other state. Direct transitions
such as `pending → completed` and `blocked → completed` are valid. `completed` and `cancelled` are
immutable terminal snapshots and cannot reopen; continued responsibility uses a new Task.

The Task may carry an ordered list of textual Acceptance Criteria, one Assignee, a Blocked Reason, a
Completion Summary, a Cancellation Reason, and actor-derived Closure Metadata. Core validates the
projected final snapshot rather than individual patch fields in isolation:

- `in_progress` requires an Assignee;
- `blocked` requires an Assignee and Blocked Reason;
- `completed` requires a Completion Summary and complete Closure Metadata;
- `cancelled` requires a Cancellation Reason and complete Closure Metadata;
- state-specific reason/summary fields and Closure Metadata are absent outside their applicable state;
- clearing the Assignee is valid only when the final state is `pending`.

Acceptance Criteria are ordered textual conditions, not individually tracked progress and not Core
verification. Completion remains an authorized declaration, not proof that tests, quality, criteria, or
user acceptance have been independently verified.

### 3. Make Task Coordination Authority explicit

All eligible Members can invoke the fixed Built-in Task operations under ADR-0124; no Member-varying
Task Capability gate returns. Core authorizes each record mutation by Camp, actor, ownership, Default
Lead role, visibility, projected final state, and expected version:

- the User and Default Lead hold Task Coordination Authority over every non-terminal Task in the Camp,
  including cancellation;
- an ordinary Agent may update a Task currently assigned to itself, including editing, transfer,
  release, blocking, and completion, but may not cancel it;
- an ordinary Agent may atomically claim an unassigned Task only for itself; the projected final state
  of that claim may be `pending`, `in_progress`, or `blocked`, never `completed` or `cancelled`;
- Task Creator identity grants persistent read visibility but no mutation authority over a Task
  assigned to someone else;
- a System actor cannot independently read or mutate business Tasks.

`availableActions` remains the closed advisory set `update | claim`: User/Lead and the ordinary current
Assignee receive `update`, an ordinary Agent viewing an unassigned Task receives `claim`, creator-only
visibility and terminal Tasks receive no action. It is not a second command surface; claim still uses
the versioned update operation.

### 4. Separate current membership from execution eligibility

A Task may be created for or transferred to a Current CampMember regardless of temporary Member
Presence. An Executable Assignee is separately defined as a Current CampMember whose Member Presence is
`present`; only that stronger condition can admit new Task-linked execution.

For current terminology, Current CampMember means the membership relationship alone. This locally
replaces ADR-0058's phrase that every “current-membership query” conjoins `presence = present`: operations
that require both facts must name and check execution/routing eligibility explicitly rather than
redefining membership. Existing Default Lead validity and other Presence-aware operations keep their
own explicit rules.

When one CampMembership ends (`active → left`), the same membership mutation atomically releases every
non-terminal Task assigned to that member in the Camp:

```text
pending     → pending
in_progress → pending
blocked     → pending
assigneeAgentId = null
blockedReason = null
version += 1
cause = assignee_membership_ended
```

The release emits ordinary Task update audit facts but no CampMessage and is attributed as a domain side
effect of the membership mutation, not as independent System Task authority. `present → away` does not
release responsibility. Terminal Tasks keep their historical Assignee.

### 5. Make permanent removal a managed atomic cascade

`RemoveMember` keeps the existing safety gate: if the AgentProfile owns any `queued`, `running`, or
`waiting` AgentRun, Core rejects the command with `agent_profile.non_terminal_runs`. Current
CampMembership, open Task assignment, and Default Lead role are not separate rejection conditions.

When the non-terminal AgentRun count is zero, one database transaction must:

1. enumerate every Current CampMembership for that AgentProfile;
2. invoke the same internal membership-ending domain path for each Camp, including membership closure,
   non-terminal Task release, Default Lead successor/reconciliation, and membership/Task/Lead audit;
3. mark the AgentProfile `removed` only after every Camp has closed successfully;
4. roll back every Camp mutation and the Profile mutation if any step fails.

The direct cause of each Task release remains `assignee_membership_ended`; `RemoveMember` is only an
upper-level orchestrator of membership endings. A user never has to leave Camps one by one before
removing a Member. Removal preview exposes the non-terminal AgentRun count, Current CampMembership
count, open assigned Task count, and Default Lead Camp count so the UI can explain the cascade before
confirmation.

An accepted A2A Message Delivery that has not materialized an AgentRun is not part of the non-terminal
AgentRun gate. After removal it may fail its independent recipient membership or Presence eligibility
check; that is identity removal, not revocation by a later Task update.

### 6. Locally replace earlier Task clauses

This ADR locally replaces ADR-0058's Lightweight Task shape, absence of Acceptance Criteria, Default
Lead read-only rule, conjoined current-membership terminology for Task assignment, unavailable-Assignee
repair rule, and Task-related Presence/removal consequences.
It also locally replaces ADR-0057's rule that permanent removal may leave non-terminal Tasks assigned to
the removed Agent. ADR-0057 and ADR-0058 remain authoritative for their other Presence, routing,
collaboration, retention, and execution-admission clauses.

Field limits, operation inputs/results, transaction ordering, no-op behavior, visibility queries, list
projection, and capacity limits are specified by the Durable Task v2 contract rather than duplicated in
this ADR.

## Consequences

- A durable responsibility can explain why it is blocked or closed without becoming a workflow graph.
- Default Lead authority now matches the coordination behavior expected by the product and is explicitly
  bounded to Task rather than implying general Camp administration.
- Ordinary Agents can complete work they own but cannot terminate the responsibility itself through
  cancellation.
- Temporary absence preserves ownership, while ending a Camp membership cannot strand a non-terminal
  responsibility on a former member.
- Membership ending must update a bounded set of Camp Tasks atomically and produce auditable per-Task
  version changes; permanent removal composes those same mutations into one all-or-nothing transaction.
- All mutation handlers and Renderer forms must validate projected final state; field-by-field validation
  alone is insufficient.

## Rejected Alternatives

- **Make Task a workflow engine.** Dependencies, deadlines, priority, progress, budgets, and evidence
  gates would conflate responsibility tracking with orchestration and execution.
- **Let Default Lead remain read-only.** The coordinator could observe but not repair, reassign, block, or
  cancel stranded Camp responsibilities, and the documentation would continue to disagree with code.
- **Allow any Assignee to cancel.** Cancellation terminates the responsibility itself; an Agent that
  cannot continue should block it or release it to `pending` instead.
- **Allow claim-and-close in one mutation.** It would let any ordinary Agent with unassigned visibility
  terminally dispose of a responsibility without first establishing durable ownership.
- **Release on `present → away`.** Temporary absence would silently discard responsibility and would not
  be reversible when the Member returns.
- **Retain a removed Agent as non-terminal Assignee.** It creates durable ownership by an identity that
  can never participate again.
- **Require the user to leave every Camp before removal.** It exposes aggregate coordination as manual
  cleanup and permits a half-finished removal workflow across Camps.
- **Release Tasks directly from the Profile mutation.** It creates a second release authority and loses
  the CampMembership-ending cause shared with ordinary Camp leave.

## References

- [v0.47 version overview](../versions/v0.47/README.md)
- [Durable Task v2 contract](../contracts/durable-task-v2.md)
- [ADR-0057: Member Presence and Retained Permanent Removal](0057-member-presence-and-retained-removal.md)
- [ADR-0058: Collaboration v4](0058-collaboration-v4-presence-aware-admission.md)
- [ADR-0124: CLI-Only Transport for Rovai Built-in Operations](0124-cli-only-transport-for-rovai-built-in-operations.md)
- [Rovai-ai domain language](../../CONTEXT.md)
