---
document_type: adr
id: ADR-0069
title: "Single Effective Memory and Scope-Bounded Agent Mutation"
status: accepted
date: 2026-07-29
decision_scope: cross-version
source_version: v0.21
supersedes: [ADR-0024, ADR-0025, ADR-0036, ADR-0037, ADR-0038, ADR-0039, ADR-0040, ADR-0052, ADR-0064]
superseded_by: null
---

# ADR-0069: Single Effective Memory and Scope-Bounded Agent Mutation

## Context

The current Memory model distinguishes `user_confirmed` and `provisional` Revisions. Agent
submissions may become pending Proposals, automatically formed lower-authority Memory or later
same-body confirmed Revisions. This creates three product concepts for one question—whether an
active Memory is usable—and requires a confirmation queue even for bounded Companion and
Relationship learning.

The desired product contract is simpler: every active Memory has the same state-machine effect,
while authorship remains visible for audit and UI. Hearth is the exception because one Agent's
suggestion would affect every AgentProfile; it still requires a user decision before becoming
active.

## Decision

### Closed Memory meaning without authority tiers

Memory Kind remains a closed immutable identity:

```text
preference
agreement
lesson
```

Its legal Scope matrix is:

```text
Hearth         Preference | Agreement | Lesson
Companion      Preference | Agreement | Lesson
Relationship   Agreement | Lesson
```

Preference means a stable collaboration choice, Agreement means a prospective collaboration rule,
and Lesson means a reusable action pattern grounded in experience. None of those terms implies
that the user personally authored or endorsed the text. Authorship is shown through provenance.
Relationship Preference remains illegal, as do generic facts, personality/ability ratings,
secrets, credentials, transient Task/Run state and repository facts that have another authority.

An active current Memory has one effective state. `MemoryRevisionAuthority`,
`user_confirmed`, `provisional`, confirmation transitions and authority-based conflict ordering do
not exist. Current user input, current authorization and current repository/collaboration state
always outrank Memory, regardless of origin. Memory cannot grant a Capability, satisfy an Approval
or override a current tool result.

### Immutable revisions and provenance

Each Memory keeps a stable ID, immutable Scope/Kind/Relationship Direction, Lifecycle, current
Revision pointer and optimistic version. Every Revision stores one immutable canonical body,
complete Retrieval Keys, creation time and actor provenance. Publication never mutates a prior
Revision; only the established irreversible Forget protocol may clear readable content.

Memory stores an immutable creation origin:

```text
user
agent
accepted_hearth_proposal
```

Each Revision separately records whether its actor was the user or an authenticated Agent and, for
an Agent, the Core-derived source AgentRun/Epoch/Camp evidence. Origin and revision actor are
audit/UI facts only. They do not change effectiveness, read priority, lifecycle, capacity class or
authorization. A user revision does not rewrite creation origin; an Agent revision does not turn a
user-created Memory into Agent-origin capacity.

### User authority

An authenticated user can directly create and revise every legal Scope, including Hearth, and
continues to own retire, reactivate, forget, review scheduling and explicit Supersession. User
commands use expected versions and the DomainCommandGateway but do not depend on Agent Capability
or the Agent-write policy.

There is no “confirm Agent Memory” command or pending management action for Companion or
Relationship Memory. UI may label origin and last revision actor, but an origin label is not an
activation control.

### Direct Agent write

One Team Tool command, `memory.write`, directly creates an active Memory or publishes a new current
Revision in the same transaction. For current authenticated Agent A in Camp C it can target only:

```text
Companion(A)
Relationship(A, B), where B is another present current Camp member of C
```

For Relationship add, A may choose `mutual(A, B)` or `directed(A → B)`, never
`directed(B → A)`. Revise cannot change Scope, Kind or Direction and is legal only for a current
Memory that ADR-0068 allows A to read. It requires exact `memoryId + baseRevisionId`; stale,
inactive, inaccessible or no-op writes fail without persistence.

Agent writes cannot create Hearth Memory, change Lifecycle, reactivate, forget, schedule Review,
create Supersession or mutate another Companion. Identity, Camp, counterparty, Direction actor,
Run and Epoch come from the trusted Binding and current domain state rather than model-supplied
authority fields.

### Hearth proposal exception

`memory.propose_hearth` is the only Agent proposal tool and Hearth is its only Scope. It may
propose add or revise content, but a pending Hearth Memory Proposal is not a Memory, is not
searchable/readable by Agents and has no effect.

The user decides each pending proposal by accept, edit-and-accept or reject:

- accept revalidates body, Retrieval Keys, duplicates, capacity and current authorization, then
  creates the active Hearth Memory/Revision in the same transaction;
- revise acceptance additionally requires the proposal's immutable
  `baseRevisionId == currentRevisionId`;
- a stale revise proposal remains visible as stale but cannot be accepted or rebased in place;
- rejection clears candidate body and Retrieval Keys while retaining body-free attribution;
- acceptance retains the original candidate for comparison with an edited final Revision;
- forgetting the linked Memory clears any retained accepted candidate body.

Pending proposals do not expire automatically. An exact duplicate of an earlier pending
add/revise candidate is rejected while preserving the earliest row and without consuming another
Run quota slot; Core never infers semantic equivalence. Source Camp/Run/Epoch values are weak,
Core-derived audit references: source deletion disables navigation but does not cascade-delete or
invalidate the proposal.

The user may bypass this queue by directly creating or revising Hearth Memory. An accepted Hearth
Memory has the same effect as every other active Memory; its provenance records only that an Agent
suggested and the user adopted it. Because the user decision is the activation boundary, it
consumes ordinary Hearth capacity but is not a direct Agent-origin Memory.

### Capability, live policy and bounds

Both Agent mutation tools require:

- a current unambiguous Native Binding and fenced running AgentRun;
- present current Camp membership;
- frozen effective business Capability `memory.write`;
- the live application policy `agentMemoryWritesEnabled = true`;
- Scope/Kind/Direction authorization;
- deterministic Secret Filter, canonicalization, duplicate and no-op checks;
- optimistic Revision/Memory concurrency checks;
- all active and Agent-origin capacity checks.

New AgentProfiles receive the Capability by default; Profile defaults and CampMember overrides
may revoke it for future Runs. The application policy defaults to true and is read inside every
write transaction, so turning it off immediately blocks both tools even for an older Run.
Disabling it does not retire, forget, revise or otherwise change existing Memory or Hearth
proposals.

The two tools share a hard quota of four successful persistent mutations per source AgentRun.
Rejected calls and read-only Memory calls do not consume the quota.

All active capacity is count-based:

```text
Hearth                                      32
Companion per Agent                         32
unordered Relationship pair                12
all Relationship Memory applicable to A     48
```

The Agent-origin subset is additionally bounded:

```text
Hearth                                       0
Companion(A)                                 8
unordered Relationship pair                 4
all Agent-origin Relationship applicable A  16
```

Pair counts include mutual and both directions. A's applicable total includes mutual and
`directed(A → B)`, not `directed(B → A)`. A mutual entry is checked against both members'
applicable totals; a directed entry is checked only against its actor's applicable total. The
same rule applies to the Agent-origin subset. Add and Reactivate consume count capacity; Revision,
Retire and Forget do not add a slot. There is no aggregate Scope byte quota. Each canonical body
remains limited to 2,048 UTF-8 bytes.

Capacity failure never creates a fallback Proposal, evicts existing Memory, truncates content or
silently succeeds. Review remains advisory and has no authority transition; all Lessons use the
same 90-day default regardless of origin, while Preference and Agreement have no automatic review
date.

### Atomicity and receipts

All successful Memory writes, Hearth proposal decisions, idempotent command results and body-free
events commit through ADR-0001 in one SQLite transaction. Agent tool receipts state the exact
result:

```text
memory.write            effective active Memory/Revision
memory.propose_hearth   pending, not effective
```

Receipts, events, diagnostics and permanent command results never copy candidate or Memory body
text. Tool discovery, Skill prose, model confidence, repetition and another Agent's agreement do
not substitute for Capability, policy or a required Hearth user decision.

This ADR replaces the general Proposal, provisional/confirmed authority, old automatic-formation
matrix and confirmation semantics of its superseded ADRs in full. It also replaces only
ADR-0057's retained default `memory.propose_change` Capability clause with the default
`memory.write` Capability above; ADR-0057's Member Presence and removal semantics remain effective.
The two mutation tools extend ADR-0014's existing stable Team Tool Gateway and do not introduce a
separate Memory connector or credential.

## Consequences

- The Memory state machine answers effectiveness with Lifecycle alone; provenance remains visible
  without changing model priority.
- Companion and applicable Relationship learning no longer creates a human confirmation queue and
  can revise current content immediately.
- Hearth keeps an explicit user activation boundary because its blast radius spans all
  AgentProfiles.
- Direct Agent revision has meaningful power, so live fencing, strict Scope checks, CAS, Secret
  Filter, count bounds, per-Run quota and the global off switch are mandatory.
- Removing authority tiers deletes same-body confirmation Revisions and provisional capacity, UI,
  export and projection concepts.
- Exact origin and revision actor evidence must survive source Camp/Run deletion without retaining
  source message bodies.

## Rejected Alternatives

- Keep `provisional` as an effective lower-priority state: preserves a second authority machine
  and optional confirmation workflow the product no longer needs.
- Make every Agent submission pending: prevents ordinary partner learning and creates review
  work.
- Let Agents write Hearth directly: one Agent could establish guidance for every partner without
  user review.
- Require user confirmation for Agent revisions but not adds: creates inconsistent effectiveness
  and encourages duplicate Memories instead of correction.
- Let an Agent write another Companion or `directed(B → A)`: permits durable assertions outside
  its own bounded identity.
- Turn policy-off into bulk removal: makes a future-facing control unexpectedly destructive.
- Evict old Memory when capacity is full: makes durable behavior disappear without an explicit
  lifecycle command.
- Treat origin as conflict priority: recreates authority tiers under a different field name.

## References

- [v0.21 Native Session Bootstrap 与 AgentRun 动态上下文重构](../versions/v0.21/README.md)
- [ADR-0001: Core Transaction](0001-core-transaction.md)
- [ADR-0014: Stable Team Tool Gateway v2](0014-stable-team-tool-gateway-v2.md)
- [ADR-0019: Application-Global Memory Ownership](0019-application-global-memory-ownership.md)
- [ADR-0022: Immutable Memory Scope](0022-immutable-memory-scope.md)
- [ADR-0026: Explicit Memory Supersession](0026-explicit-memory-supersession.md)
- [ADR-0027: Memory-Domain Forgetting](0027-memory-domain-forgetting.md)
- [ADR-0029: Bounded Memory Reactivation](0029-bounded-memory-reactivation.md)
- [ADR-0057: Member Presence](0057-member-presence-and-retained-removal.md)
- [ADR-0068: Brokered Memory Retrieval](0068-brokered-memory-retrieval-and-session-entrypoint.md)
- [ADR-0024: Closed Memory Kinds](0024-closed-memory-kinds.md)
- [ADR-0025: Proposal-Scoped Memory Provenance](0025-proposal-scoped-memory-provenance.md)
- [ADR-0036: Agent-Bounded Memory Proposal Scope](0036-agent-bounded-memory-proposal-scope.md)
- [ADR-0037: Actor-Bounded Relationship Proposal Direction](0037-actor-bounded-relationship-proposal-direction.md)
- [ADR-0038: Memory Proposal Staleness](0038-memory-proposal-staleness.md)
- [ADR-0039: Memory Proposal Capability](0039-memory-proposal-capability.md)
- [ADR-0040: Terminal Memory Proposal Retention](0040-terminal-memory-proposal-retention.md)
- [ADR-0052: Explicit Memory Revision Authority](0052-explicit-memory-revision-authority.md)
- [ADR-0064: Automatic Partner Memory Formation](0064-default-on-bounded-automatic-partner-memory.md)
