---
document_type: adr
id: ADR-0119
title: Append-Only Versioned Evidence-to-Operation Identity Bindings
status: superseded
date: 2026-08-05
decision_scope: cross-version
source_version: v0.41
supersedes: []
superseded_by: ADR-0122
---

# ADR-0119: Append-Only Versioned Evidence-to-Operation Identity Bindings

ADR-0113 separates Evidence deduplication from operation identity, while ADR-0116 separates operation
identity from semantic classification. v0.41 also needs a durable rule for binding individual Evidence
to operations without mutating immutable Evidence, silently regrouping history, or letting a classifier
upgrade change lifecycle correlation.

## Decision

### 1. Evidence-to-operation binding is Core-owned and append-only

Core models the relationship between activity Evidence and an operation as an explicit identity binding.
When activity Evidence is admitted, the same SQLite transaction must register or reuse an operation and
persist exactly one immutable default binding for that Evidence. Reasoning, narration, final response,
and other non-activity presentation tracks do not receive operation bindings.

`source_event_key`, Evidence identity, operation identity, and binding identity remain separate. A source
key deduplicates one incoming Evidence fact; it never creates or changes a lifecycle grouping.

### 2. Identity authority is conservative

Core chooses operation identity in this order:

1. a verified Core operation/Action identity;
2. a stable structured identity reported by the Runtime and fenced by AgentRun, execution epoch, and
   available native session/turn identity;
3. when neither exists, a new isolated `unknown` operation for that one Evidence.

Titles, commands, cwd, timestamps, adjacency, provider names, and workspace changes cannot create a
binding or merge operations.

### 3. Identity evolution uses a separate version axis

The default binding set is immutable. A later identity improvement may only create a parallel binding
set under a new `operationIdentityVersion`; it cannot update or delete the original binding set. Reads,
replay output, and diagnostics must identify which operation identity version they use, and default
historical reads must not silently switch versions.

`operationIdentityVersion` and `classifierVersion` are orthogonal:

- changing `operationIdentityVersion` may change which Evidence belongs to which operation;
- changing `classifierVersion` may change the semantic Projection of an already selected operation
  binding set, but may not regroup Evidence or change operation identity;
- ordinary classifier reprojection therefore operates within one explicit operation identity version.

### 4. Projection and Read Side consume explicit bindings

Canonical Runtime Activity Projection is generated only from Evidence selected by an explicit operation
binding set. Lifecycle Read Side groups by the selected `operationId` and Projection version; it does not
implement another correlation algorithm or fall back to provider text.

Live ingestion, recovery, and explicit replay must use the same binding contract. A mapping failure keeps
the Evidence and an honest isolated/unknown result; it does not authorize a best-effort merge.

## Consequences

- identity correction and semantic reclassification can evolve independently and remain auditable;
- the physical schema needs an operation registry, append-only versioned bindings, uniqueness for one
  default binding per activity Evidence, and explicit selection of identity/classifier versions;
- an identity improvement may produce a visibly different parallel lifecycle grouping, but never a
  silent change to the default historical view;
- Runtimes without stable activity identity may show more isolated unknown operations, preserving
  observational honesty at the cost of compactness.

## Rejected alternatives

- storing `operationId` only as mutable derived data on an Evidence row;
- allowing a classifier replay to regroup Evidence;
- late rebinding that silently replaces the default identity relationship;
- deriving lifecycle groups in Renderer or Read Side from titles, commands, timing, or adjacency;
- attaching reasoning, narration, or final-response display records to synthetic operations.

## References

- [ADR-0111: Core-Owned Canonical Runtime Activity and Observation-Honest Lifecycle Projection](0111-core-owned-canonical-runtime-activity.md)
- [ADR-0112: Immutable Execution Evidence and Rebuildable Versioned Canonical Activity Projection](0112-immutable-execution-evidence-and-rebuildable-canonical-activity-projection.md)
- [ADR-0113: Core-Scoped Operation Identity and Evidence Deduplication Boundary](0113-core-scoped-operation-identity-and-evidence-deduplication-boundary.md)
- [ADR-0116: Projection-Pinned Classifier Version and Explicit Historical Reprojection](0116-projection-pinned-classifier-version-and-explicit-historical-reprojection.md)
- [ADR-0120: Run-Epoch-Pinned Identity Rules and Frozen Evidence Binding Sets](0120-run-epoch-pinned-identity-rules-and-frozen-binding-sets.md)
