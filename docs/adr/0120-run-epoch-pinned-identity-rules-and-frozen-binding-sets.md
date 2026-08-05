---
document_type: adr
id: ADR-0120
title: Run-Epoch-Pinned Identity Rules and Frozen Evidence Binding Sets
status: superseded
date: 2026-08-05
decision_scope: cross-version
source_version: v0.41
supersedes: []
superseded_by: ADR-0122
---

# ADR-0120: Run-Epoch-Pinned Identity Rules and Frozen Evidence Binding Sets

ADR-0119 requires versioned parallel Evidence-to-operation bindings, but a rule version and one
materialized binding result are not the same identity. Reusing one field for both would make two
replays of the same rule at different Evidence watermarks indistinguishable and could let an in-flight
AgentRun silently change grouping rules.

## Decision

### 1. `operationIdentityVersion` identifies immutable rules

`operationIdentityVersion` names one immutable operation-identity rule/registry version. The default
identity rule is pinned for each `(agentRunId, executionEpoch)` when its first activity Evidence is
admitted and cannot change during that epoch, including across Core restart and recovery.

A newer identity rule is used by default only for a new AgentRun execution epoch. It never changes the
default binding semantics of an existing epoch.

### 2. `operationBindingSetId` identifies one complete materialization

`operationBindingSetId` identifies the complete binding set produced by applying one explicit
`operationIdentityVersion` to one AgentRun execution epoch at one frozen Evidence watermark. The set
must retain enough provenance to identify at least:

- `agentRunId` and `executionEpoch`;
- `operationIdentityVersion`;
- the frozen Evidence through-sequence/watermark and an Evidence input digest;
- the identity mapping/registry digest used for the materialization.

Two materializations that use the same identity rule but different Evidence watermarks are different
binding sets. A partial collection of rows is not a valid complete binding set.

### 3. Historical identity improvement is explicit and parallel

Historical identity improvement runs only through an explicit replay over a frozen Evidence input and
creates a parallel binding set with its own `operationBindingSetId`. It does not update the default
identity rule, replace the default binding set, or silently change default historical reads.

An in-flight Run may have a diagnostic replay preview, but it cannot enter the default user-visible
Lifecycle Projection or regroup the live activity stream. A user-visible parallel binding set must be
bound to an explicit frozen Evidence watermark.

### 4. Classifier Projection consumes a selected binding set

Canonical Projection must identify the selected `operationBindingSetId` in addition to its own
`classifierVersion` and Projection version. A classifier replay consumes one binding set as fixed
input; it cannot append bindings, change the Evidence watermark, or reinterpret identity rules.

## Consequences

- operation identity rules, materialized grouping results, and semantic classifiers have distinct,
  independently auditable version axes;
- recovery can prove that a Run epoch retained one default identity rule rather than consulting a
  mutable global latest version;
- storage and Read Side APIs must select complete binding sets and reject partial/mixed-watermark rows;
- historical identity improvements require explicit replay provenance and may coexist with the default
  historical grouping without replacing it.

## Rejected alternatives

- using `operationIdentityVersion` as both rule version and binding-set primary key;
- changing the default identity rule of an active or historical AgentRun epoch;
- treating each Evidence or operation as independently versioned identity input within one default Run
  epoch;
- allowing a partially written or mixed-watermark binding collection to drive Lifecycle Projection;
- automatically promoting a replayed binding set to the default historical view.

## References

- [ADR-0112: Immutable Execution Evidence and Rebuildable Versioned Canonical Activity Projection](0112-immutable-execution-evidence-and-rebuildable-canonical-activity-projection.md)
- [ADR-0113: Core-Scoped Operation Identity and Evidence Deduplication Boundary](0113-core-scoped-operation-identity-and-evidence-deduplication-boundary.md)
- [ADR-0116: Projection-Pinned Classifier Version and Explicit Historical Reprojection](0116-projection-pinned-classifier-version-and-explicit-historical-reprojection.md)
- [ADR-0119: Append-Only Versioned Evidence-to-Operation Identity Bindings](0119-versioned-evidence-to-operation-identity-bindings.md)
- [ADR-0121: Append-Only Binding Ledger and Immutable Sealed Binding-Set Heads](0121-append-only-binding-ledger-and-sealed-binding-set-heads.md)
