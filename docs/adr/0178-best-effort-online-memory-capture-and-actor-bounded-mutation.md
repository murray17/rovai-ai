---
document_type: adr
id: ADR-0178
title: Best-Effort Online Memory Capture and Actor-Bounded Agent Mutation
status: accepted
date: 2026-08-13
decision_scope: cross-version
source_version: v0.73
supersedes:
  - ADR-0069
intended_supersedes: []
superseded_by: null
---

# ADR-0178: Best-Effort Online Memory Capture and Actor-Bounded Agent Mutation

## Context

ADR-0069 established one effective Memory state, direct Companion/Relationship writes and a separate Hearth
proposal operation. It also allowed one Agent to create or revise a mutual Relationship Memory. The current
product instead needs a purely online capture path in which Runtime-native Skill discovery helps an Agent notice a
possible durable collaboration understanding, while Core keeps the durable authority boundary deterministic.

Skill availability cannot prove that a model loaded the Skill on a particular turn. A free-text Relationship entry
also cannot safely become a bilateral obligation merely because one participant wrote it. Finally, making Hearth
content effective for every Member still requires an explicit user decision even if the Agent-facing command is
later simplified.

## Decision

### Online capture has a best-effort service level

Agent-origin Memory capture is an online, `memory-stewardship`-guided workflow:

```text
possible durable information
  -> Runtime-native Skill discovery
  -> Companion / Relationship / Hearth judgment
  -> search, then read when needed
  -> add, revise, or stop
```

The system-required Skill is available to every supported Runtime, but neither an implicit opportunity nor a
natural-language request such as “remember this” receives a deterministic loading guarantee. The product does not
add a capture clause to the Session Charter, an end-of-Run checkpoint, offline reflection, an opportunity database,
or a semantic relation classifier. If deterministic user governance is required, a structured Renderer action
invokes an authenticated user command; an Agent cannot simulate Forget by writing contrary text.

### Memory remains single-effective and provenance-aware

Memory Kind remains the closed set `preference | agreement | lesson`. Hearth and Companion allow all three;
Relationship allows only `agreement | lesson`. Every active Memory selects exactly one effective immutable Revision.
Origin and Revision actor provenance remain audit and UI facts, never an authority tier, model priority, Capability,
Approval, or substitute for current user input and current repository or collaboration state.

Formation origin is the immutable closed set `user | agent | accepted_hearth_review`. Only `agent` consumes
Agent-origin capacity; accepting a Hearth Review Item remains a user activation even though its source Agent is
retained. Every Revision separately records user/Agent actor provenance and, for an Agent, Core-derived Camp/Run/Epoch
evidence. Later user or Agent revisions do not rewrite formation origin or change its capacity class, and weak source
deletion never cascade-deletes formal Memory.

An authenticated user may create and revise every legal Scope and direction, including mutual Relationship, and
retains the existing retire, reactivate, forget, review-scheduling and Supersession commands. User content mutations
use Memory version and, when publishing a Revision, the exact base Revision.

### Agent mutation is bounded to the actor's own durable responsibility

For current authenticated Agent A in current Camp C, Agent mutation may only:

```text
add/revise Companion(A)
add/revise directed Relationship(A -> B),
  where B is another present current Member of C
submit Hearth add/revise content for user review
```

An Agent may not add or revise `mutual(A, B)`, `directed(B -> A)`, another Companion, any Memory lifecycle, Review
schedule or Supersession. Existing mutual Relationship Memory remains legal and readable by both participants under
ADR-0068, but only the user may change it. Directed Relationship remains readable and applicable only to its actor;
the counterparty cannot use it as a persistent cross-Agent content channel.

Agent revise uses exact `memoryId + baseRevisionId`, cannot change Scope, Kind, pair or direction, and is allowed only
when the target is active, currently applicable and inside the same actor-bounded mutation set. A Hearth submission
does not create a Memory or MemoryRevision. It creates an independent Hearth Review Item whose candidate content is
visible only to the authenticated user review surface; only acceptance publishes an effective Revision.

### Core keeps deterministic safety and resource admission

Every Agent mutation revalidates the current unambiguous Native Binding, fenced running AgentRun, execution epoch,
present current Camp membership, Scope/Kind/direction, counterparty, canonical body and Retrieval Keys, Secret
Filter, idempotency, exact duplicate/no-change, Revision concurrency, active capacity, Agent-origin capacity and
per-Run quota in the mutation transaction. Semantic durability and add-versus-revise judgment remain with the Agent;
Core does not infer semantic equivalence.

All current Members retain equal built-in operation eligibility under ADR-0124. There is no Member-varying business
Capability gate and no `agentMemoryWritesEnabled` policy.

The retained bounds are:

```text
successful Agent mutations per AgentRun                 4
canonical body bytes                                 2,048
active Hearth / Companion(A)                         32 / 32
active Relationship per pair / applicable to A      12 / 48
Agent-origin Companion(A)                                 8
Agent-origin Relationship per pair / applicable to A  4 / 16
direct Agent-origin Hearth                                0
```

Creating a pending Hearth Review Item consumes one successful Agent mutation slot but no active Memory capacity.
Revision, Retire and Forget do not add an active slot. Capacity failure never evicts, truncates or creates a fallback
candidate.

Review scheduling remains advisory rather than an effectiveness state: Lesson defaults to review after 90 days
regardless of origin, while Preference and Agreement have no automatic review date. Becoming due never changes
Lifecycle or content and only the user may continue, reschedule, revise, retire or forget it.

All mutations, body-free events and durable command results use the existing Core transaction and idempotency
boundary. Search/read authorization, FTS fail-closed behavior, cache states and guessed-ID anti-oracle behavior remain
owned by ADR-0068.

This decision completely supersedes ADR-0069. ADR-0124's later removal of Capability and global Memory-write policy
continues to apply and is incorporated here rather than restored.

## Consequences

- Runtime-native discovery can improve online capture without becoming a product promise that every natural-language
  intent is processed.
- Agents can maintain their own Companion and directed pair responsibilities, but cannot unilaterally create a
  bilateral obligation or a reverse-direction assertion.
- Hearth keeps a user activation boundary while ordinary Companion and directed Relationship writes remain
  immediately effective.
- The direct mutation path stays small, but Core must preserve live fencing, exact concurrency, capacity, quota,
  Secret Filter and body-free evidence on every call.
- A future Agent-authored mutual workflow would require an explicit same-candidate acknowledgement protocol and a new
  decision; ordinary Message IDs are insufficient evidence.

## Rejected Alternatives

- **Claim deterministic handling for explicit natural-language Memory requests.** Skill delivery and discovery do not
  prove per-turn model loading; a structured user command is the deterministic boundary.
- **Add end-of-Run or offline reflection.** It creates another capture lifecycle, persistence surface and source of
  late writes without solving online judgment quality.
- **Allow one Agent to write mutual Relationship after reading ordinary messages.** Message participation does not
  prove acceptance of one exact durable candidate.
- **Let the counterparty read directed free text.** Without structured obligations and acknowledgement, this creates a
  durable cross-Agent content channel.
- **Let Agents write Hearth directly.** One Agent would establish guidance for every Member without user review.
- **Restore Capability or a global write switch.** That conflicts with the equal fixed-operation eligibility adopted
  by ADR-0124 and does not replace request-specific domain admission.

## References

- [v0.73 在线长期记忆捕获与 Hearth 审核隔离](../versions/v0.73/README.md)
- [ADR-0001: Core Transaction](0001-core-transaction.md)
- [ADR-0019: Application-Global Memory Ownership](0019-application-global-memory-ownership.md)
- [ADR-0022: Immutable Memory Scope](0022-immutable-memory-scope.md)
- [ADR-0026: Explicit Memory Supersession](0026-explicit-memory-supersession.md)
- [ADR-0027: Memory-Domain Forgetting](0027-memory-domain-forgetting.md)
- [ADR-0068: Brokered Memory Retrieval and Session Entrypoint](0068-brokered-memory-retrieval-and-session-entrypoint.md)
- [ADR-0069: Single Effective Memory (historical)](0069-single-effective-memory-and-scope-bounded-agent-mutation.md)
- [ADR-0124: CLI-Only Transport for Rovai Built-in Operations](0124-cli-only-transport-for-rovai-built-in-operations.md)
- [Memory Capture v1](../contracts/memory-capture-v1.md)
- [Online Memory Capture architecture](../architecture/online-memory-capture.md)
