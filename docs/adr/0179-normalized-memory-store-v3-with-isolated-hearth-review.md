---
document_type: adr
id: ADR-0179
title: Normalized Memory Store v3 with Isolated Hearth Review
status: accepted
date: 2026-08-13
decision_scope: cross-version
source_version: v0.73
supersedes:
  - ADR-0070
intended_supersedes: []
superseded_by: null
---

# ADR-0179: Normalized Memory Store v3 with Isolated Hearth Review

## Context

ADR-0070 gives Hearth-only proposals a separate table, but its terminal model can retain accepted candidate text and
its Forget cleanup is centered on candidates linked to an accepted Memory. A pending Hearth add has no target Memory;
if the same content is published directly and later forgotten, that old pending candidate could recreate content the
user already removed. Renaming a pending candidate to a MemoryRevision would instead spread non-effective content
through Revision, retrieval, export and forgetting semantics.

The persistence model therefore needs a review aggregate that is independent from Memory, has its own concurrency and
terminal lifecycle, never enters Agent reads, and closes every path by which candidate content could survive formal
publication or Memory Forget.

## Decision

### Memory and Hearth review are separate authoritative aggregates

The existing application SQLite database remains the sole authority. Memory Store v3 contains the logical families:

```text
memory
memory_revision
memory_revision_retrieval_key
hearth_review_item
memory_supersession
```

Only `memory` and `memory_revision` represent published Memory. `hearth_review_item` represents an Agent-submitted,
user-review-only candidate and never becomes a pending or rejected Revision. FTS remains a reconstructible index over
active current formal Revisions only; a Review Item candidate never enters FTS, Memory Entrypoint, Memory Search,
Memory Read, export or Agent-visible evidence.

The derived search layer remains SQLite FTS5 trigram over separate Retrieval Key and body columns with BM25 weights
6 and 1. FTS is never authority for Scope, Lifecycle, body, keys or access; integrity failure makes search unavailable
until deterministic rebuild while authorized direct reads continue from formal rows. Search/Read evidence retains only
digests, authorization basis, IDs, Revision/cache states and outcomes, never complete query, snippet, body or candidate.

Review Item persistent status is the closed set `pending | accepted | rejected | invalidated`. Staleness is derived for
a pending revise when its target is absent, non-active, non-Hearth, or no longer selects `baseRevisionId`; it is not a
stored status. A stale item cannot be accepted or rebased, but the user may reject it. There is no separate dismiss or
close state.

### Pending candidate content is isolated; terminal rows are body-free

A pending item owns its action, candidate Kind where needed, canonical candidate body, complete Retrieval Keys,
target/base identity where needed, opaque canonical digest, source Agent/Camp/Run/Epoch, optimistic version and time.
Source references are weak audit references and never cascade-delete the application-global Review Item.

Acceptance creates one formal Memory or Revision and then clears candidate Kind, body, Retrieval Keys and digest in
the same transaction. Rejection and invalidation clear the same fields. Terminal rows retain only body-free source,
action, target/base, accepted Memory/Revision references, resolver, timestamps, invalidation reason and whether the
user edited before acceptance. The product deliberately gives up a post-accept original-versus-final text diff;
the accepted MemoryRevision is the only long-term body.

The internal digest is never returned through Agent, Renderer, event, command-result or diagnostic contracts. For an
add it identifies exact canonical Hearth Kind and body, matching formal active-Memory duplicate semantics; Retrieval
Keys cannot create a second same-body Memory. For a revise it also binds target, base and the complete key set. An
exact pending duplicate produces only a body-free `duplicate_pending` rejection and preserves the earliest row.

### Publication and Forget close targetless recreation paths

Every direct-user or accepted-review publication of a formal Hearth add or Revision atomically invalidates every
other pending Hearth add with the same final Kind and canonical body, clears its candidate fields and records the
body-free reason `exact_candidate_published`. This applies when edit-and-accept makes the final content equal to a
different pending candidate.

Before Memory Forget clears a Hearth Memory, the same pending-add reconciliation runs for every still-readable formal
Revision body of that target, not only its current Revision. This is a safeguard for candidates and historical
Revisions created before v3 publication reconciliation existed. The Forget transaction then clears every formal
Revision body and Retrieval Key, removes FTS rows,
and clears every Review Item associated by `targetMemoryId` or accepted Memory reference. Pending target items become
`invalidated` with reason `target_forgotten`; all terminal linked rows remain body-free. No event, command result,
Supersession row, index or retained digest can reconstruct the forgotten text.

### Review decisions have two independent compare-and-swap boundaries

Every decision checks `expectedReviewItemVersion`. A revise acceptance separately requires the formal target to be an
active Hearth Memory whose `currentRevisionId == baseRevisionId`. Add acceptance revalidates candidate content,
Secret Filter, exact duplicate, capacity and current user authorization. Edit-and-accept changes only the candidate
body and complete key set used for that transaction; it does not change or silently rebase the original target/base.

Formal Memory and Review Item mutations, derived-index maintenance, body-free event and durable idempotent result
commit in one immediate SQLite transaction. Repositories do not commit independently.

### Existing data is migrated without erasing formal Memory

The v3 migration preserves formal Memory, Revisions, Retrieval Keys and Supersession. Existing Hearth proposal rows
become Review Items with equivalent source, target/base, decision and accepted references. Pending rows receive the
new digest; pending adds already equal to any retained formal Hearth Revision become body-free `invalidated` rows with
`exact_candidate_published`. Accepted and rejected rows have candidate fields cleared during migration. Existing
Agent-origin mutual Relationship Memory is preserved as formal history and active content, but ADR-0178 prevents
future Agent mutation of it.

This decision completely supersedes ADR-0070. SQLite, immutable formal Revisions, normalized Retrieval Keys,
reconstructible FTS, DomainCommandGateway transactions and non-event-sourced authority remain unchanged.

## Consequences

- User review can persist independently without granting Agent read access or polluting formal Revision history.
- Acceptance, rejection, invalidation and Forget have one body-clearing rule, reducing duplicate secret and retention
  surfaces.
- Stale revise display requires joining the current target state at read time instead of bulk status updates.
- Publication must reconcile matching pending adds in the same transaction; this additional write prevents a later
  targetless candidate from recreating published-and-forgotten content.
- Migrated accepted reviews lose their retained original candidate text by design, while body-free provenance and
  formal accepted Revision remain.

## Rejected Alternatives

- **Model pending Hearth content as MemoryRevision.** Non-effective content would leak into formal lifecycle, search,
  export and Forget responsibilities.
- **Persist `stale` as a status.** Every target Revision change would require fan-out writes and race with review reads.
- **Keep accepted candidate text for audit diff.** It creates a second long-term body and expands every Forget path.
- **Invalidate only review items with `targetMemoryId`.** Pending add has no target and can recreate content after
  direct publication and Forget.
- **Retain the digest after terminal resolution.** A body-derived value would outlive its only operational purpose and
  enlarge the Forget surface.
- **Reset all Memory data.** The new model can preserve formal Memory and transform the narrower review rows without a
  destructive clean break.

## References

- [v0.73 在线长期记忆捕获与 Hearth 审核隔离](../versions/v0.73/README.md)
- [ADR-0001: Core Transaction](0001-core-transaction.md)
- [ADR-0019: Application-Global Memory Ownership](0019-application-global-memory-ownership.md)
- [ADR-0027: Memory-Domain Forgetting](0027-memory-domain-forgetting.md)
- [ADR-0068: Brokered Memory Retrieval and Session Entrypoint](0068-brokered-memory-retrieval-and-session-entrypoint.md)
- [ADR-0070: Normalized SQLite Memory Store v2 (historical)](0070-normalized-sqlite-memory-store-v2.md)
- [ADR-0178: Best-Effort Online Memory Capture](0178-best-effort-online-memory-capture-and-actor-bounded-mutation.md)
- [Memory Capture v1](../contracts/memory-capture-v1.md)
- [Online Memory Capture architecture](../architecture/online-memory-capture.md)
