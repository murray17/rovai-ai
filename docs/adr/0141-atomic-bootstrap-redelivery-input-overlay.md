---
document_type: adr
id: ADR-0141
title: Atomic Bootstrap Redelivery Input Overlay and Transient Identity Boundary
status: accepted
date: 2026-08-08
decision_scope: cross-version
source_version: v0.48
supersedes: []
superseded_by: null
---

# ADR-0141: Atomic Bootstrap Redelivery Input Overlay and Transient Identity Boundary

> [ADR-0147](0147-lossless-model-context-projection-and-layered-delivery-evidence.md) 局部替代本文的
> exact model-facing Redelivery marker、wording 与 v1 formatter identity，当前目标为 Redelivery Envelope
> v2 / Formatter v2。本文的 serialized preparation、transient Identity、Dynamic-only ContextManifest、
> Runtime Input Delivery Evidence、combined budget 和 accepted-ACK 边界继续有效。

## Context

Current context delivery materializes and persists one ContextManifest before separately preparing a
Runtime Input Delivery. Without one serialization boundary, a compaction observation could arrive
between those operations. If redelivery were selected only by the later operation, a previously
maximum-sized Dynamic Context might no longer have room for the complete Bootstrap. Mutating the
immutable ContextManifest after selection would break deterministic context evidence.

ADR-0100 intentionally keeps the complete formatted Bootstrap, Member Identity snapshot and any
identity-bearing prompt digest transient. Redelivery must reuse that privacy boundary while giving the
Delivery Gate durable evidence of which Requirement it attempted to consume.

## Decision

### One serialized Runtime input preparation boundary

Context selection and Runtime Input Delivery preparation form one logical Core critical section. The
implementation may stage managed blobs or commit an unsendable ContextManifest before the Delivery,
but it must hold the same exclusive Core database authority throughout. No compaction callback may
commit between redelivery selection and `RuntimeInputDelivery.prepared`, and no transport may receive
payload bytes until the Delivery exists.

The critical section revalidates the current AgentRun and Native Binding generation, reads the current
requested/acknowledged revisions, selects any pending revision, applies the combined payload budget,
persists the Dynamic Context-only ContextManifest, and inserts the Runtime Input Delivery with its
redelivery metadata. The implementation may use more than one SQLite transaction inside that section.
If it commits a Manifest first, that row is staging state only: a crash must reuse it and reselect the
then-current pending revision before any Delivery can become sendable. The Delivery `prepared` commit
is the ADR-0140 cutoff. A later observation advances a future Requirement and cannot patch the
prepared input.

### Redelivery is a transient input overlay

When selected, Core invokes the existing Bootstrap assembler; it does not create a second Bootstrap
model. Stable components come from the current Binding generation's original Bootstrap Evidence, and
Member Identity is the latest committed six-field projection read once for this eligible delivery, as
defined by ADR-0100.

The versioned model-facing order is:

```text
[ROVAI_BOOTSTRAP_REDELIVERY]
【补发】Native Session Bootstrap
原因：Runtime 已报告当前 Native Session 已发生或即将发生会话上下文压缩。
以下内容用于恢复可能因压缩而丢失的会话级长期上下文。

<existing complete Native Session Bootstrap>
[/ROVAI_BOOTSTRAP_REDELIVERY]

<immutable AgentRun Dynamic Context>
```

The redelivery envelope encloses both the notice and the complete Bootstrap. Its wording and marker
are formatter-versioned. It is not a user task, Camp Message, Run Notice or new Native Session.

### Evidence and privacy

ContextManifest continues to persist only the exact AgentRun Dynamic Context and its existing source
evidence. Runtime Input Delivery persists the selected redelivery revision, stable Bootstrap Evidence
ID, presence flag, and redelivery envelope/Bootstrap formatter versions. It does not persist the
complete overlay, complete Runtime input, Member Identity bytes or snapshot, or a digest incorporating
Member Identity.

An accepted Runtime Input proves that Core completed a delivery carrying the selected Requirement,
but retained evidence cannot reconstruct or prove the exact identity bytes. This deliberately extends
ADR-0100's transient complete-Bootstrap boundary to redelivery.

### Combined budget and failure

The complete redelivery envelope is non-truncatable and counts against the existing maximum Runtime
payload bytes. During serialized preparation Core deterministically reduces only optional Dynamic
Context according to the existing Context Delivery Profile until the combined payload fits;
ContextManifest records the resulting exact Dynamic Context and omission evidence. Required Bootstrap
sections and Current Input are never removed to make room.

If the envelope plus irreducible Dynamic Context exceeds the Runtime payload limit, preparation fails
closed before `RuntimeInputDelivery.prepared`; no partial Bootstrap or unbudgeted input is sent.

Because the identity-bearing bytes are transient, process loss cannot claim byte-identical overlay
reconstruction. A failed or `delivery_unknown` attempt does not acknowledge the Requirement. Recovery
must first reconcile the existing Delivery and may prepare a later eligible input only after proving
that doing so cannot duplicate an accepted input; it never blindly resends reconstructed “same” bytes.

## Consequences

- The materialize-to-prepare race is removed without requiring one oversized SQLite transaction or
  moving Bootstrap into ContextManifest.
- Redelivery uses the latest identity while creating no durable identity history.
- Every prepared combined input is within the same bounded Runtime payload contract as a new-Session
  first payload.
- Dynamic history may be smaller on a redelivery Run, but its deterministic omission remains visible in
  ContextManifest evidence.
- Runtime Input Delivery schema and preparation call sites require a clean migration and serialized
  Core API.

## Rejected Alternatives

- Put the complete redelivery in ContextManifest: persists or digests Member Identity and contradicts
  ADR-0100.
- Append Bootstrap after an already prepared Dynamic Context: creates an unbudgeted payload and races
  immutable evidence.
- Reserve worst-case Bootstrap space on every ordinary prompt: permanently reduces useful Dynamic
  Context even when no Requirement exists.
- Truncate Bootstrap or Current Input: destroys the recovery contract or the user's actual task.
- Persist the combined Runtime payload for exact retry: creates the identity history ADR-0100 rejects.
- Rebuild and blindly resend after process loss: overclaims byte identity and may duplicate an accepted
  input.

## References

- [v0.48 Native Session Compaction Bootstrap Redelivery](../versions/v0.48/README.md)
- [ADR-0100: Latest Member Identity in Native Session Bootstrap](0100-latest-member-identity-native-session-bootstrap.md)
- [ADR-0138: Durable Bootstrap Redelivery Requirement](0138-durable-bootstrap-redelivery-requirement.md)
- [ADR-0140: Runtime-Specific Compaction Signal Admission Point](0140-runtime-specific-compaction-signal-admission-point.md)
- [Native Session Bootstrap Redelivery Architecture](../architecture/native-session-bootstrap-redelivery.md)
- [ADR-0142: Native-Session-Scoped Compaction Observer Lease](0142-native-session-scoped-compaction-observer-lease.md)
