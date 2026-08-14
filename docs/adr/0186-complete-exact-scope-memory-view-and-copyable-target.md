---
document_type: adr
id: ADR-0186
title: Complete Exact-Scope Memory View and Copyable Revision Target
status: accepted
date: 2026-08-14
decision_scope: cross-version
source_version: v0.78
supersedes: [ADR-0183]
intended_supersedes: []
superseded_by: null
---

# ADR-0186: Complete Exact-Scope Memory View and Copyable Revision Target

## Context

ADR-0183 made Agent-relative Scope identity visible in Search/Read and required revise to repeat that identity. It
solved authorized wrong-counterparty mutation, but online capture still used bounded relevance Search. Search cannot
prove that an Agent inspected every active Memory in the selected Scope, so a valid top-k result may omit an equivalent
Memory and permit a duplicate add.

Pagination would replace top-k incompleteness with a new completion problem: an Agent could stop before the last page,
pages would need snapshot identity and expiry, and write would need additional proof if Core were to know that the
whole set was checked. The product is not yet launched, so retaining pre-release Memory data is less valuable than a
small, closed first contract.

## Decision

1. Online Memory capture uses a new `memory.view` operation before `memory.write`. One invocation returns the complete
   current applicable set for exactly one selected Scope; it never paginates, truncates or returns a partial success.
2. Hearth View is the local Rovai home application-global effective Hearth set. Companion View is the authenticated
   Agent's effective Companion set. Relationship View is actor-relative for one exact unordered pair: for Agent A and
   counterparty B it returns `directed(A -> B)` plus `mutual(A, B)`, never `directed(B -> A)`.
3. Every View item carries one indivisible `target` containing Memory ID, current Revision ID and complete Agent-relative
   Scope identity. `memory.read` uses the same target for body-bearing `current | revision_changed` results; body-free
   stale/unavailable results omit it. Mutual items are readable but explicitly not Agent-revisable.
4. Agent revise copies `target` unchanged. The closed revise shape admits only directed Relationship target; a mutual
   target is rejected as invalid input without looking up its Memory. For a structurally valid target, Core validates
   active target, actor mutation set and complete Scope identity before exposing Revision CAS or exact no-change.
   Unknown, inactive, unauthorized, reverse-directed or identity-mismatched targets retain one body-free unavailable
   result.
5. Complete View is kept bounded by active current-body quotas in addition to existing entry counts and the 2,048-byte
   per-Memory body limit: Hearth application-global 16 KiB, Companion per AgentProfile 16 KiB, and Relationship per
   unordered pair 12 KiB. Every transaction that can increase final active body bytes checks its final state;
   Retire/Forget release quota.
6. View is formed and access evidence is recorded in one SQLite transaction. Success is measured against the actual
   minified canonical JSON Agent projection. The output hard limit is 64 KiB; overflow or a broken Scope invariant
   fails closed as unavailable before evidence is recorded.
7. Search remains the bounded cross-Scope discovery operation and Read remains the authoritative stable-ID/cache-state
   operation. They do not substitute for exact-Scope View in online duplicate judgment.
8. This is a pre-release Memory-domain clean break. Migration clears formal Memory, Revisions, keys, Review Items,
   Supersession, access evidence, FTS rows, Memory domain events and Memory command results while preserving Camps,
   Tasks, messages, AgentProfiles and other application state.

This ADR completely replaces ADR-0183: it retains Search Scope identity and anti-oracle requirements while replacing
the repeated flat revise identity with one copyable target and adding the complete exact-Scope View boundary.

## Consequences

- Normal online capture becomes one complete View plus at most one write, so duplicate judgment no longer depends on
  top-k recall or an Agent finishing an implicit page sequence.
- Scope quotas are user-visible domain capacity, not a transport truncation heuristic. Large knowledge collections may
  eventually require a different projection or retrieval model rather than silently weakening View completeness.
- View and Write remain separate calls. Revision CAS protects revise concurrency; concurrent semantically equivalent
  adds remain best-effort because Core performs exact, not semantic, duplicate comparison.
- Transport, CLI command version, Runtime capability and catalog digest advance together; old Native Sessions are
  fenced from the thirteen-operation surface.
- The clean break deliberately discards pre-release Memory content and its Memory-local audit/idempotency state.

## Rejected Alternatives

- **Paginate View in v1.** This reintroduces unread pages, snapshot/cursor expiry and completion proof while preserving
  roughly the same total model input.
- **Keep Search as the online duplicate gate.** Bounded relevance results cannot establish complete Scope inspection.
- **Lower the single Memory body limit to fit transport.** Transport convenience should not force an otherwise valid
  atomic Memory to split; aggregate Scope capacity closes the full response instead.
- **Silently truncate an oversized View.** A partial set would make `complete` untrue and permit duplicate writes.
- **Preserve or grandfather old Memory during migration.** The unlaunched product does not justify transition states,
  over-quota grandfathering or candidate migration complexity.
- **Let the Skill reconstruct target fields.** Reconstruction turns immutable identity back into a semantic selection
  problem and risks authorized wrong-target mutation.

## References

- [v0.78 current version](../versions/v0.78/README.md)
- [Memory Capture v3](../contracts/memory-capture-v3.md)
- [Built-in Tool Transport v11](../contracts/builtin-tool-transport-v11.md)
- [ADR-0068: Brokered Memory Retrieval](0068-brokered-memory-retrieval-and-session-entrypoint.md)
- [ADR-0178: Best-Effort Online Memory Capture](0178-best-effort-online-memory-capture-and-actor-bounded-mutation.md)
- [ADR-0183: Scope-Identified Agent Memory Revision Targets](0183-scope-identified-agent-memory-revision-targets.md)
- [Online Memory Capture architecture](../architecture/online-memory-capture.md)
