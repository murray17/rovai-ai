---
document_type: adr
id: ADR-0052
title: "Explicit Memory Revision Authority"
status: superseded
date: 2026-07-27
decision_scope: cross-version
source_version: v0.13
supersedes: [ADR-0021, ADR-0033]
superseded_by: ADR-0069
---

# ADR-0052: Explicit Memory Revision Authority

## Context

ADR-0021 modeled every `MemoryRevision` as content the user had confirmed, while ADR-0033 used
Revision `createdAt` as the confirmation time. That model is internally consistent only while an
Agent can save a non-effective Proposal and every effective Revision is created by a user command.

v0.13 introduces one narrowly preauthorized path that can make a Companion Lesson effective as a
provisional Revision without per-item confirmation. Treating that Revision as user-confirmed would
make the audit false. Storing `provisional` only on `Memory` would also lose the authority history
when the current Revision changes, and mutating the same Revision in place during confirmation
would weaken immutable revision evidence.

## Decision

### Atomic Memory and immutable content

Each atomic long-term recognition remains one stable `Memory` with a permanent `memoryId`, a
selected current `MemoryRevision`, and optimistic Memory versioning.

Every `MemoryRevision`:

- has a stable `revisionId` and belongs to exactly one Memory;
- stores one complete canonical body;
- is immutable after publication except for the existing irreversible Forget clearing protocol;
- records one immutable authority value:

```text
user_confirmed
provisional
```

- records `createdAt` as Revision creation time, not as a universal confirmation timestamp;
- remains in revision history after it stops being current unless Forget clears its readable body.

The current Memory authority is the authority of its selected current Revision. Authority is not a
Memory Lifecycle value and does not add a fourth Lifecycle state.

### Revision creation rules

The following paths create a `user_confirmed` Revision:

- a user directly creates or revises Memory;
- a user accepts or edits and accepts a pending Proposal;
- a user confirms a current provisional Revision.

The bounded policy path defined by ADR-0053 creates a `provisional` Revision. No other Agent,
Runtime, confidence score, repeated observation or system component may choose provisional
authority.

Confirming an active provisional Revision creates a new immutable `user_confirmed` Revision with
the same canonical body and an explicit `confirmedFromRevisionId` link to the provisional base. It
uses `memoryId + expectedVersion + baseRevisionId` Compare-and-Set. This is the sole same-body
Revision operation and is not rejected as a content no-op because authority changes. Editing
provisional content through a user revise command instead creates an ordinary new
`user_confirmed` Revision.

Formal revision, confirmation and Proposal acceptance never overwrite a newer current Revision.
The stale Proposal rules in ADR-0038 continue to apply.

### Review and time

v0.13 still has no `validFrom`, `validUntil` or automatic authority transition. Time alone never
confirms, retires, forgets or removes a Revision from Projection.

Default advisory Review is:

```text
provisional lesson      → Revision createdAt + 30 days
user-confirmed lesson   → Revision createdAt + 90 days
preference/agreement    → null
```

The user may reschedule Review for any active or retired Memory. Review due remains a Read Side
condition only.

Retire and eligible Reactivate preserve the current Revision and its authority. Reactivating a
provisional Memory must recheck both ordinary Scope capacity and the provisional capacity defined
by ADR-0053.

### Migration and read surfaces

All readable Revisions created before the v0.13 migration are backfilled as `user_confirmed`.
Historical `createdAt` values are not rewritten.

Memory management, Projection, export and audit Read Sides must expose current Revision authority.
Agent-readable Projection does not expose user identity or command audit, but it must distinguish
confirmed and provisional entries as required by ADR-0054.

## Consequences

- The system can represent policy-authorized learning without falsely attributing confirmation to
  the user.
- Authority history remains tied to immutable content revisions and survives later revision.
- Same-body confirmation creates one additional Revision, but the audit can prove exactly which
  provisional content the user confirmed and when.
- Existing data migrates conservatively to `user_confirmed`; the migration does not infer new
  provisional content.
- Review can surface unattended provisional Lessons without silently changing their effect.
- Contracts, export format, Projection formatter and Memory tests must add authority coverage.

## Rejected Alternatives

- Put `provisional` on Memory: loses the authority of historical Revisions and becomes ambiguous
  after revise.
- Mutate a provisional Revision to confirmed: weakens immutable revision evidence and erases the
  original authority transition.
- Treat `createdAt` as confirmation for every Revision: falsely labels policy-created content.
- Create a fourth Lifecycle state: mixes content authority with active/retired/forgotten usage.
- Automatically confirm after time or repetition: lets elapsed time or Agent behavior replace a
  user decision.

## References

- [v0.13 伙伴经验自动沉淀](../versions/v0.13/README.md)
- [ADR-0019: Application-Global Memory Ownership](0019-application-global-memory-ownership.md)
- [ADR-0022: Immutable Memory Scope](0022-immutable-memory-scope.md)
- [ADR-0024: Closed Memory Kinds](0024-closed-memory-kinds.md)
- [ADR-0038: Memory Proposal Staleness](0038-memory-proposal-staleness.md)
- [ADR-0053: User-Preauthorized Provisional Companion Lessons](0053-user-preauthorized-provisional-companion-lessons.md)
- [Superseded ADR-0021](0021-atomic-memory-and-immutable-revisions.md)
- [Superseded ADR-0033](0033-advisory-memory-review-v2.md)
