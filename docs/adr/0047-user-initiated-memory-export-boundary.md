---
document_type: adr
id: ADR-0047
title: "User-Initiated Memory Export Boundary"
status: accepted
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: null
---

# ADR-0047: User-Initiated Memory Export Boundary

## Context

Memory is personal, user-governed data, so users need a way to take a copy outside Lumen.
Automatic Memory-specific backup or cloud synchronization would introduce another replica,
retention policy, identity boundary, and Forget contract. Those systems are not otherwise part of
v0.10.

The Markdown Projection cannot serve as an export or backup source. It is a disposable,
Agent-specific read side that may omit directions not applicable to that Agent and may be
temporarily unavailable while SQLite remains healthy.

Once a user exports plaintext data to a location outside Lumen, the Memory Domain cannot reliably
find or erase every copy after a later Forget command.

## Decision

v0.10 provides explicit user-initiated Memory export. It does not add Memory-specific automatic
backup, background replication, cloud synchronization, or restore.

Every export is generated from the authoritative SQLite Memory state, never by copying or parsing
Markdown Projection files. Forgotten bodies are excluded from every export path.

Before creating an export, the product must clearly state that the resulting external copy leaves
Lumen's Lifecycle and Forget boundary. A later Memory Forget clears Lumen's controlled Memory
content but cannot retract or erase user-controlled export files, operating-system snapshots, or
other external copies.

The export encoding, selectable scope and lifecycle filters, and included revision-history depth
are implementation-protocol choices. They must preserve this boundary and cannot turn Projection
into a backup source.

## Consequences

- Users can take custody of their Memory data without introducing hidden automatic replicas.
- v0.10 avoids designing cloud identity, encryption keys, synchronization conflicts, retention,
  and restore semantics.
- Export remains complete according to authoritative state rather than an Agent's partial view.
- UI copy must distinguish Lumen-controlled Forget from deletion of external copies.
- An import or restore workflow is not implied by the existence of export.

## Rejected Alternatives

- Memory-specific automatic local backup: creates another managed retention and Forget surface.
- Cloud synchronization in v0.10: requires identity, encryption, conflict, and deletion semantics
  beyond the Memory domain being introduced.
- Copying the Projection tree: exports partial, derived, and possibly unavailable views.
- Claiming Forget covers exported files: Lumen cannot discover or control user-owned copies.
- Treating export as restore format by default: import trust and conflict behavior require a
  separate decision.

## References

- [v0.10 长期记忆](../versions/v0.10/README.md)
- [ADR-0013: Managed Content and Read Side v2](0013-managed-content-and-read-side-v2.md)
- [ADR-0027: Memory-Domain Forgetting](0027-memory-domain-forgetting.md)
- [ADR-0053: User-Preauthorized Provisional Companion Lessons](0053-user-preauthorized-provisional-companion-lessons.md)
- [ADR-0045: Normalized SQLite Memory Store](0045-normalized-sqlite-memory-store.md)
