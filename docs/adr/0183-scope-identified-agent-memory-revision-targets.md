---
document_type: adr
id: ADR-0183
title: Scope-Identified Agent Memory Revision Targets
status: superseded
date: 2026-08-14
decision_scope: cross-version
source_version: v0.75
supersedes: []
intended_supersedes: []
superseded_by: ADR-0186
---

# ADR-0183: Scope-Identified Agent Memory Revision Targets

## Context

ADR-0068 lets one Agent search and read Hearth, its Companion, and multiple applicable Relationship Memories, but its
Search/Read result shape identifies only Memory, Revision, Kind and content metadata. Two directed Relationship
Memories for different counterparties can therefore have indistinguishable text and Retrieval Keys. ADR-0178's
actor-bounded revise guard proves that the caller may mutate a selected Memory; it cannot prove that the selected
counterparty is the one the Agent intended.

Relying only on body similarity or Skill prose would leave a normal, authorized wrong-target mutation possible. Adding
Scope data also must not weaken guessed-ID anti-oracle behavior or turn immutable Scope into an editable field.

## Decision

1. Every authorized `memory.search` result exposes the Memory's Agent-relative immutable Scope identity:
   `scope`, and for Relationship additionally `counterpartyAgentId` plus `direction`.
2. `memory.read` exposes the same identity only with `current` or `revision_changed` results that also return the
   currently authorized body. `inactive`, `deleted`, `access_changed` and `unavailable` results expose no Scope,
   counterparty or direction.
3. Agent `memory.write(action=revise)` must repeat the exact Scope identity returned by the deciding read. Companion
   and Hearth repeat `scope`; Relationship also repeats `counterpartyAgentId` and the `directed` direction. These
   fields are immutable target assertions, not proposed changes.
4. Core first requires a well-formed revise shape, then loads an active target and verifies the caller's mutation set.
   Before exposing Revision CAS or exact no-change, it verifies the repeated Scope identity against the target. An
   absent, inactive, unauthorized, reverse-directed, mutual, or identity-mismatched target returns the same
   body-free `memory.unavailable` result.
5. A mutual Relationship may remain visible for use but is not a valid Agent revise shape. A target whose ID,
   Revision, Scope, counterparty or direction cannot be matched exactly must not be revised.
6. The closed input/output schema change advances the Built-in Tool contract, CLI command contract and Runtime
   capability together. Catalog digest fencing remains an additional compatibility check.

This decision locally refines ADR-0068's Search/Read result fields and ADR-0178's exact revise precondition. Their
applicable-set, authorization, cache-state, anti-oracle, actor-bounded mutation and Hearth review decisions otherwise
remain effective.

## Consequences

- Similar Relationship text for different teammates can be selected and revised deterministically.
- Search/Read responses and the revise schema gain explicit fields, so existing Native Sessions must be fenced by the
  successor Built-in Tool contract and catalog digest.
- Agents must perform read-before-revise and copy identity exactly; this adds payload ceremony but turns semantic
  targeting into a Core-verifiable precondition.
- Scope identity remains omitted from body-free stale and unavailable reads, preserving the existing guessed-ID
  anti-oracle.

## Rejected Alternatives

- **Return Scope metadata but trust Skill prose to select correctly.** This improves reasoning but leaves Core able to
  commit an authorized mutation to the wrong counterparty.
- **Infer the intended counterparty from candidate text or Retrieval Keys.** Similarity is not identity and would add
  a nondeterministic authorization-adjacent classifier.
- **Return only `counterpartyAgentId`.** Hearth, Companion and Relationship would still lack one complete, copyable
  target identity, and direction would remain ambiguous.
- **Return Scope identity on stale or unavailable reads.** That would reintroduce an existence and target-shape
  oracle for guessed or no-longer-authorized IDs.
- **Treat repeated Scope fields as a requested move.** Memory Scope is immutable; moving an understanding creates a
  new Memory and may be recorded through explicit user Supersession.

## References

- [v0.75 current version](../versions/v0.75/README.md)
- [ADR-0068: Brokered Memory Retrieval and Session Entrypoint](0068-brokered-memory-retrieval-and-session-entrypoint.md)
- [ADR-0178: Best-Effort Online Memory Capture](0178-best-effort-online-memory-capture-and-actor-bounded-mutation.md)
- [Memory Capture v2](../contracts/memory-capture-v2.md)
- [Built-in Tool Transport v10](../contracts/builtin-tool-transport-v10.md)
- [Online Memory Capture architecture](../architecture/online-memory-capture.md)
