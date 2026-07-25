---
document_type: adr
id: ADR-0045
title: "Normalized SQLite Memory Store"
status: accepted
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: null
---

# ADR-0045: Normalized SQLite Memory Store

## Context

Lumen already commits authoritative domain state, expected-version concurrency, idempotent command
results and redacted audit events in one SQLite database. Memory adds stable entities, immutable
Revisions, non-authoritative Proposals, explicit Supersession and reconstructible filesystem
projections. Collapsing these relationships into one JSON document would create whole-library
write conflicts and weak constraints; replaying Memory from events would introduce a second
persistence architecture.

No released version before v0.10 has authoritative Memory records, so migration does not need to
infer durable knowledge from historical chats or repository files.

## Decision

Add a normalized Memory Store to the existing `lumen.sqlite` with these table families:

```text
memory
memory_revision
memory_proposal
memory_supersession
memory_projection_observation
```

`memory` owns stable identity, immutable Scope/Kind/Direction, Lifecycle, selected current
Revision, Review scheduling, entity version and timestamps.

`memory_revision` stores immutable canonical body text, Memory identity, creation time and optional
`createdFromProposalId`.

`memory_proposal` stores add/revise candidate state, target/base where applicable, closed status,
proposer/time and weak source Camp/AgentRun/Epoch. Candidate body is nullable only for the clearing
rules established by ADR-0027 and ADR-0040.

`memory_supersession` stores immutable predecessor-to-successor relationships independently from
Lifecycle.

`memory_projection_observation` is derived recovery state for exposed location, formatter version,
digest, health and diagnostics. It never owns Memory content.

All authoritative writes use the existing DomainCommandGateway and one SQLite transaction for
domain changes, expected versions, idempotent result and redacted event. Small bodies remain
SQLite text, not Managed Blob.

Memory is not rebuilt from event replay and has no single JSON aggregate, FTS index, separate
database or Markdown write path. Proposal source IDs must remain weak audit references and cannot
use cascading ownership that deletes Proposals with a Camp or AgentRun.

Migration adds new tables, constraints and indexes through the existing additive schema mechanism.
It does not scan Conversation, Camp, Task, AgentRun, Skill, Git or project files to synthesize
initial Memory.

## Consequences

- Atomic Memories and Revisions can update independently without whole-file conflicts.
- SQLite constraints and indexes can enforce scope, lifecycle, duplicate and capacity protocols.
- Proposal retention and source deletion semantics remain representable without copied source
  content.
- Projection reconciliation can be diagnosed without becoming a second content truth.
- Migration is additive and starts with an empty Memory Library.
- Exact DDL, CHECK constraints and indexes remain implementation-plan details bounded by this ADR.

## Rejected Alternatives

- One JSON Memory Library row: creates coarse concurrency and weak relational validation.
- Event-sourced Memory: adds replay and migration complexity absent from other current domains.
- Markdown as database: breaks transactional user authority and deterministic rebuild.
- Separate Memory database: fragments Core transactions, backup and diagnostics.
- FTS in v0.10: there is no Agent search tool and user-scale bounded collections do not require it.
- Backfilling from history: would infer durable knowledge without user proposals or confirmation.

## References

- [v0.10 长期记忆](../versions/v0.10/README.md)
- [ADR-0001: Core Transaction](0001-core-transaction.md)
- [ADR-0021: Atomic Memory and Immutable Revisions](0021-atomic-memory-and-immutable-revisions.md)
- [ADR-0025: Proposal-Scoped Memory Provenance](0025-proposal-scoped-memory-provenance.md)
- [ADR-0026: Explicit Memory Supersession](0026-explicit-memory-supersession.md)
- [ADR-0032: User-Authorized Live Memory Projection](0032-user-authorized-live-memory-projection.md)
