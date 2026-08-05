---
document_type: adr
id: ADR-0121
title: Append-Only Binding Ledger and Immutable Sealed Binding-Set Heads
status: superseded
date: 2026-08-05
decision_scope: cross-version
source_version: v0.41
supersedes: []
superseded_by: ADR-0122
---

# ADR-0121: Append-Only Binding Ledger and Immutable Sealed Binding-Set Heads

Activity Evidence arrives while an AgentRun is live, but ADR-0120 defines each readable Binding Set at
a frozen Evidence watermark. A mutable set would therefore make one `operationBindingSetId` mean
different content over time, while delaying all sets until Run termination would give live and recovery
reads different identity inputs.

## Decision

### 1. Default bindings use an append-only Binding Ledger

Core records default Evidence-to-operation bindings in an append-only Binding Ledger. Existing ledger
facts are never updated or removed to represent a newer Evidence frontier.

### 2. Every readable Binding Set is immutable, complete, and sealed

A Binding Set is eligible for Canonical Projection or Lifecycle Read Side only after it is complete and
sealed. Once sealed, its manifest and logical membership never grow, change, or disappear. Partial,
building, or otherwise unsealed materialization is not a readable Binding Set.

### 3. Live progress publishes new sealed sets and advances the default head

During an active AgentRun, Core continuously publishes new sealed Binding Sets as the eligible Evidence
frontier advances, then moves that Run epoch's default Binding Set head to the newly sealed set. The head
may advance; the set it previously selected remains immutable and retained.

Old Binding Sets are never grown, overwritten, or deleted. Historical and recovery reads can therefore
name the exact sealed set they consumed even after the default head has advanced.

### 4. Physical encoding remains a separate implementation gate

This decision does not select full-copy versus parent/delta manifests, a content-addressed versus opaque
`operationBindingSetId`, staging-table layout, transaction batching, or the physical representation of
the default head. Those choices must preserve the append-only ledger, sealed-set completeness, immutable
historical sets, and live head semantics above and require separate confirmation before implementation.

## Consequences

- one `operationBindingSetId` has stable meaning for all future reads;
- live and recovery projections can consume the same class of sealed input rather than separate
  correlation paths;
- implementations may structurally share data between sets, but logical manifests and old set identities
  remain retained;
- publication and crash-recovery tests must prove that no partial set becomes readable and that head
  advancement never mutates the previously selected set.

## Rejected alternatives

- appending members to an already readable Binding Set;
- overwriting or deleting the previous set when the default head advances;
- exposing partial/best-effort binding rows as a complete set;
- using only a live mutable ledger and creating the first sealed set at Run termination.

## References

- [ADR-0112: Immutable Execution Evidence and Rebuildable Versioned Canonical Activity Projection](0112-immutable-execution-evidence-and-rebuildable-canonical-activity-projection.md)
- [ADR-0119: Append-Only Versioned Evidence-to-Operation Identity Bindings](0119-versioned-evidence-to-operation-identity-bindings.md)
- [ADR-0120: Run-Epoch-Pinned Identity Rules and Frozen Evidence Binding Sets](0120-run-epoch-pinned-identity-rules-and-frozen-binding-sets.md)
