---
document_type: adr
id: ADR-0037
title: "Actor-Bounded Relationship Proposal Direction"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0069
---

# ADR-0037: Actor-Bounded Relationship Proposal Direction

## Context

ADR-0036 allows Agent A to create an add Proposal for Relationship(A, B) when B is another
current member of the source Camp, but deliberately leaves the requested Direction unresolved.
Allowing A to propose `directed(B → A)` would let one Agent assign a durable one-way obligation
to another Agent. User confirmation prevents automatic effect, yet the Proposal itself would
still frame B's future conduct without coming from B.

Forbidding A from proposing `mutual` would be unnecessarily restrictive: mutual content is
explicitly presented as a suggestion and the user remains the sole formal authority.

## Decision

Within a Relationship(A, B) target authorized by ADR-0036, Agent A may create an add Proposal only
with:

```text
mutual(A, B)
directed(A → B)
```

Agent A cannot propose `directed(B → A)`. A one-way rule for B must instead be proposed from a
current fenced AgentRun of B or created directly by the user.

For `directed`, Gateway derives actor A from the current Native Binding and AgentRun. The model
does not provide an actor ID; it only selects the direction form and a counterparty that Gateway
validates as another current member of the source Camp.

Either pair member may propose `mutual`. The other Agent does not gain a separate acceptance or
veto state: a MemoryProposal remains non-authoritative until the user accepts it, and the user is
the only formal confirmation authority.

Revise Proposals cannot change Direction. Agent A can revise only a mutual or
`directed(A → B)` Memory already present in A's supported Projection, subject to
`memoryId + baseRevisionId` concurrency checks.

## Consequences

- Agents can suggest shared collaboration rules and volunteer obligations for themselves.
- One Agent cannot create durable Proposal queue items that unilaterally assign another Agent's
  behavior.
- Gateway schema can omit actor ID and derive it from trusted execution identity.
- Mutual proposals still affect both Agent projections after user acceptance without introducing
  an Agent-consensus workflow.
- Users retain direct authority to create or correct any legal Direction.

## Rejected Alternatives

- Allowing A to propose both directed orientations: permits A to assign B a one-way obligation.
- Allowing only `directed(A → B)`: prevents Agents from suggesting genuinely shared agreements.
- Requiring B to accept a mutual Proposal: creates a second authority and a distributed approval
  state inconsistent with user governance.
- Taking actor ID from model arguments: permits identity spoofing and weakens Gateway fencing.
- Making all Relationship Memory mutual: loses asymmetric but legitimate collaboration rules.

## References

- [v0.10 长期记忆](../versions/v0.10/README.md)
- [ADR-0022: Immutable Memory Scope](0022-immutable-memory-scope.md)
- [ADR-0035: User-Transparent, Agent-Applicable Relationship Memory](0035-user-transparent-agent-applicable-relationship-memory.md)
- [ADR-0036: Agent-Bounded Memory Proposal Scope](0036-agent-bounded-memory-proposal-scope.md)
