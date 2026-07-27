---
document_type: adr
id: ADR-0041
title: "AgentProfile Status and Memory Independence"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0057
---

# ADR-0041: AgentProfile Status and Memory Independence

## Context

AgentProfile is a stable identity with `active`, `disabled` and `archived` states. Disabled or
archived profiles cannot participate in new execution but can later return to active. Companion
and Relationship Memory are application-global, long-lived records bound to that stable identity,
not to one Runtime or Camp membership.

Automatically retiring or forgetting Memory when a profile becomes inactive would turn a
reversible execution/configuration action into a hidden bulk Memory mutation. It would also make
reactivation ambiguous: Lumen would need either to revive old Memory automatically or silently
lose the partnership history.

## Decision

AgentProfile status transitions never change:

- Memory Lifecycle;
- a Memory's current Revision, Scope, Kind or Direction;
- MemorySupersession;
- MemoryProposal status or retained content.

Active Companion and Relationship Memories remain active and continue to count against their
Active Memory Scope Capacity while a related AgentProfile is disabled or archived. The user may
continue to govern those Memories and accept or reject existing Proposals.

An inactive AgentProfile cannot have a new AgentRun, so Lumen produces no Companion projection
for it. It is also ineligible as a current collaborator in another Agent's Relationship
Projection Directory. This is projection eligibility, not a Memory Lifecycle transition.

When the AgentProfile returns to active and participates in an eligible Camp, projector exposes
the same currently active Memories again. Reactivation creates no MemoryRevision, Memory
reactivation event or Proposal.

Users who want profile deactivation to coincide with Memory retirement or forgetting must issue
those explicit Memory management commands separately. The UI may offer a clearly separated batch
workflow but cannot make it an implicit status side effect.

## Consequences

- Disabling an Agent cannot accidentally erase or retire long-term partnership history.
- Re-enabling an Agent restores applicable Memory without synthetic Revisions.
- Inactive identities can continue consuming active Scope Capacity until the user governs them.
- Projection selection must check current profile/member eligibility independently from Memory
  Lifecycle.
- Pending Proposal review remains possible after the proposing or scoped Agent becomes inactive.

## Rejected Alternatives

- Automatically retiring all related Memory: conflates reversible profile state with user Memory
  governance.
- Automatically forgetting related Memory: makes a non-destructive profile action destructive.
- Excluding inactive Memory from capacity: lets active state later exceed limits on reactivation.
- Creating new Revisions on reactivation: invents content changes where none occurred.
- Automatically rejecting the profile's pending Proposals: discards user-owned review work.

## References

- [v0.10 长期记忆](../versions/v0.10/README.md)
- [ADR-0019: Application-Global Memory Ownership](0019-application-global-memory-ownership.md)
- [ADR-0035: User-Transparent, Agent-Applicable Relationship Memory](0035-user-transparent-agent-applicable-relationship-memory.md)
- [ADR-0036: Agent-Bounded Memory Proposal Scope](0036-agent-bounded-memory-proposal-scope.md)
