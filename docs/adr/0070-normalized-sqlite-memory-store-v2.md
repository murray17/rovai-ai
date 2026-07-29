---
document_type: adr
id: ADR-0070
title: "Normalized SQLite Memory Store v2"
status: accepted
date: 2026-07-29
decision_scope: cross-version
source_version: v0.21
supersedes: [ADR-0045]
superseded_by: null
---

# ADR-0070: Normalized SQLite Memory Store v2

## Context

ADR-0045 established normalized SQLite authority for Memory, but its table family is centered on a
general `memory_proposal`, Agent-readable Markdown projection observations and no full-text index.
v0.21 removes general Proposals and Agent projection reads, adds immutable Retrieval Keys,
Core-brokered search/read evidence, direct Agent revisions and one Hearth-only proposal boundary.

The application has not shipped, so preserving unreleased Memory rows or a dual schema would add
compatibility code without protecting user data. The new domain contract can replace the
development schema directly while keeping the established SQLite, transaction and immutable
Revision architecture.

## Decision

### Authoritative normalized tables

The existing application SQLite database remains the sole Memory authority. Its logical Memory
table families are:

```text
memory
memory_revision
memory_revision_retrieval_key
hearth_memory_proposal
memory_supersession
```

`memory` owns stable identity, immutable Scope/Kind/Relationship Direction, immutable creation
origin, Lifecycle, selected current Revision, Review scheduling, optimistic version and
timestamps.

`memory_revision` owns immutable canonical body text, its Memory ID, creation time and actor
provenance. `memory_revision_retrieval_key` owns the ordered, normalized immutable key set for one
Revision. Bodies and keys remain bounded SQLite text rather than Managed Blobs.

`hearth_memory_proposal` stores only Hearth add/revise candidates, immutable Agent/source
provenance, target/base Revision where applicable, closed `pending | accepted | rejected` status,
resolution metadata and the accepted Revision link. Its candidate body and keys are nullable only
for rejection and Forget clearing. Source Camp/AgentRun/Epoch references are weak audit
identifiers and never cascade-delete application-global provenance.

`memory_supersession` continues to store immutable predecessor-to-successor relationships
independently from Lifecycle.

There is no general `memory_proposal`, Revision authority column, confirmation link, provisional
capacity column or authoritative Memory JSON document. The old Agent Markdown projection and
`memory_projection_observation` are not part of the supported Agent read architecture.

### Derived search and access evidence

The store includes a reconstructible SQLite FTS5 trigram index over active current Revisions.
Retrieval Keys and body are separate indexed columns with BM25 weights 6 and 1. Lifecycle/current
Revision changes update the derived layer transactionally where possible; integrity failure marks
search unavailable until deterministic rebuild. FTS rows never become an authority for Lifecycle,
Scope, body, keys or access.

Native Session Bootstrap evidence belongs to the context-delivery domain. Memory Search/Read
evidence may use normalized or existing audit/read-side tables, but it stores only digests,
authorization basis, IDs, Revision IDs, cache states and outcomes. It never duplicates complete
queries, snippets, candidate text or Memory bodies.

### Transactions and constraints

Every authoritative mutation uses the typed DomainCommandGateway and one SQLite immediate
transaction for:

```text
current Binding/Run/Epoch and Capability checks when Agent-originated
live application policy
Scope/Kind/Direction and Presence authorization
Secret Filter and canonicalization
duplicate/no-op checks
expected Memory version and base Revision CAS
ordinary and Agent-origin count capacity
Memory/Revision/Proposal/Supersession rows
derived FTS maintenance
body-free event
idempotent command result
```

Repository methods do not commit independently. Events are audit and idempotency records, not an
event-sourced Memory store. Read models, exports and any diagnostic files are rebuilt from
authoritative rows and cannot be parsed as a write path.

### Direct development-schema replacement

v0.21 replaces the unreleased Memory schema directly. Migration may drop and recreate all old
Memory, Revision, Proposal, projection-observation and Memory-search structures. It does not
backfill, reinterpret or preserve old development Memory rows, infer Memory from conversations or
files, or maintain compatibility views and dual read/write paths.

Non-Memory application data remains outside this reset. Fresh schema seeds
`agentMemoryWritesEnabled = true` and the target capability defaults; it does not synthesize
Memory or Hearth proposals.

This ADR replaces ADR-0045 in full.

## Consequences

- Memory identity, immutable revisions, Hearth proposals and Supersession keep relational
  constraints without a whole-library write conflict.
- The schema directly represents the single-effective-state model and no longer carries dormant
  provisional/general-proposal concepts.
- FTS becomes disposable acceleration rather than a second content or authorization truth.
- Search availability now depends on index integrity and rebuild diagnostics, while direct
  authorized reads remain possible from authoritative rows.
- Development databases lose old Memory data during the v0.21 schema switch; no production
  compatibility machinery is created.
- Forget and rejection must clear every controlled candidate/body location transactionally,
  including linked accepted Hearth proposal text.

## Rejected Alternatives

- Evolve the old schema additively and retain compatibility columns: preserves contradictory
  authority and Proposal concepts before launch.
- Keep a general Proposal table with a Scope discriminator: makes unsupported
  Companion/Relationship pending states structurally possible.
- Use Markdown or FTS as the content truth: weakens transaction, Lifecycle and Forget guarantees.
- Put the whole Memory Library in one JSON row: creates coarse conflicts and weak relational
  constraints.
- Add a separate Memory database or event-sourced store: fragments Core transactions and
  introduces a second persistence architecture.
- Backfill durable Memory from chat history or projection files: infers long-term state without a
  valid domain mutation.
- Persist complete search queries or returned bodies as evidence: creates another secret and
  Forget surface.

## References

- [v0.21 Native Session Bootstrap 与 AgentRun 动态上下文重构](../versions/v0.21/README.md)
- [ADR-0001: Core Transaction](0001-core-transaction.md)
- [ADR-0019: Application-Global Memory Ownership](0019-application-global-memory-ownership.md)
- [ADR-0026: Explicit Memory Supersession](0026-explicit-memory-supersession.md)
- [ADR-0027: Memory-Domain Forgetting](0027-memory-domain-forgetting.md)
- [ADR-0047: User-Initiated Memory Export Boundary](0047-user-initiated-memory-export-boundary.md)
- [ADR-0068: Brokered Memory Retrieval](0068-brokered-memory-retrieval-and-session-entrypoint.md)
- [ADR-0069: Single Effective Memory](0069-single-effective-memory-and-scope-bounded-agent-mutation.md)
- [ADR-0045: Normalized SQLite Memory Store](0045-normalized-sqlite-memory-store.md)
