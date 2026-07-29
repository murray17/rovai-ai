---
document_type: adr
id: ADR-0038
title: "Memory Proposal Staleness"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0069
---

# ADR-0038: Memory Proposal Staleness

## Context

A revise MemoryProposal freezes the `baseRevisionId` that the Agent read from live Markdown.
Another user command can publish a newer Revision between file read, Proposal submission and later
user acceptance. ADR-0052 prevents an old Proposal from overwriting a newer Revision but does not
distinguish a base that is already obsolete at submission from one that becomes obsolete after a
valid Proposal has been saved.

Persisting an immediately stale Proposal creates governance noise with no valid acceptance path.
Deleting a once-valid Proposal when it later becomes stale would instead erase useful proposal
provenance and hide the real concurrency event.

## Decision

Gateway validates a revise Proposal's `baseRevisionId` against the authoritative
`currentRevisionId` in the same transaction that would save the Proposal. If they differ, the
request returns a conflict and persists no MemoryProposal.

If the base is current when saved but the Memory later advances to another Revision, the Proposal
remains `pending` and its Read Side derives `stale = true`. Stale is not a fourth Proposal status.

A stale Proposal cannot be accepted, edited and accepted, rebased in place or have its frozen base
changed. The user may reject it. Adopting any part of the candidate requires a new Proposal based
on the latest Revision.

Acceptance repeats the `baseRevisionId == currentRevisionId` Compare-and-Set check in its own
transaction. A race after a management read therefore still returns conflict without creating a
MemoryRevision or changing Proposal status.

This ADR addresses Revision drift. Lifecycle invalidation, source-object loss and Proposal
retention remain separate protocols.

## Consequences

- The governance queue never stores a revise Proposal known to be unusable at creation.
- A once-valid suggestion remains auditable if a later Revision makes it stale.
- Proposal status stays closed to `pending | accepted | rejected`; stale remains derived.
- Rebase always requires a new user-visible candidate and cannot silently reinterpret Agent text.
- Submission and acceptance both need transactional current-Revision checks.

## Rejected Alternatives

- Saving an already stale Proposal: creates an immediately unactionable pending item.
- Automatically rebasing candidate text onto the latest Revision: changes what the Agent actually
  proposed and risks semantic merge errors.
- Deleting a Proposal when it later becomes stale: loses provenance and conceals concurrency.
- Adding `stale` as a persisted status: duplicates a condition derivable from immutable base and
  current Revision.
- Accepting with last-write-wins: allows old Agent context to overwrite newer user-authorized
  Memory.

## References

- [v0.10 长期记忆](../versions/v0.10/README.md)
- [ADR-0001: Core Transaction](0001-core-transaction.md)
- [ADR-0052: Explicit Memory Revision Authority](0052-explicit-memory-revision-authority.md)
- [ADR-0053: User-Preauthorized Provisional Companion Lessons](0053-user-preauthorized-provisional-companion-lessons.md)
