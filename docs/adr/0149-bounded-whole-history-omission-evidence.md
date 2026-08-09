---
document_type: adr
id: ADR-0149
title: Bounded Whole-History Omission Evidence
status: accepted
date: 2026-08-09
decision_scope: cross-version
source_version: v0.52
supersedes: []
superseded_by: null
---

# ADR-0149: Bounded Whole-History Omission Evidence

## Context

Profile v2 limits the model-visible recent public window to 15 messages. A recipient can nevertheless have an
arbitrarily large interval between its previous accepted boundary and the current boundary. ContextManifest v8
represented every message omitted by `max_public_messages` as an inline `messageIds` array. The same array was
copied into a frozen Message Delivery and later into ContextManifest Evidence, so evidence size and preflight
allocation grew linearly with the entire interval even though the model saw only a count and sequence envelope.

The exact-ID rule remains useful for bounded candidate omissions such as budget eviction and reference-closure
failures. It is not an acceptable representation for an unbounded whole-history interval.

## Decision

ContextManifest v9 separates two omission evidence forms without changing Context Delivery Profile v2:

- `max_public_messages` is aggregate whole-history evidence containing `kind`, `reason`, `count`,
  `sequenceStart`, and `sequenceEnd`; it contains no `messageIds`;
- `history_budget`, `runtime_payload_budget`, `max_reference_chain`, `parent_unavailable`, `cycle`, and
  `tombstone` continue to carry exact `messageIds`, because their candidate sets are bounded by Profile v2 and the
  Runtime payload gate.

Core computes the whole-history aggregate in SQLite against the frozen Camp ID, previous accepted boundary,
current boundary, trigger exclusion, bounded included-message set, and bounded already-explained exact omissions.
It must not materialize the whole interval as a Rust ID vector. `sequenceStart` and `sequenceEnd` are only the
minimum/maximum envelope of the omitted set, may contain gaps, and never become an executable locator or an
authorization token.

The model-visible `omittedMessages` aggregate, message selection, ordering, Unicode-scalar limits, payload budget,
canonical `camp.read` continuation, ContextManifest exact rendered bytes, and Runtime Input Delivery accepted-ACK
authority remain unchanged. This decision locally narrows ADR-0147's rule that all exact omitted message IDs remain
in ContextManifest Evidence: exact inline IDs remain mandatory only for the bounded omission classes above.

ContextManifest v9 is a current-only clean break. Data Contract v0.52 / projection schema 28 / Migration 69
invalidates old ContextManifest, Runtime Input Delivery, Bootstrap Evidence, Binding and Native Session technical
state while preserving completed Camp, Message, Task, terminal Run and terminal Turn business history. No v8/v9
read compatibility path is retained.

## Consequences

Frozen Delivery and ContextManifest JSON remain bounded when a Camp accumulates thousands of messages between
accepted inputs. Audit consumers can distinguish aggregate interval omission from exact bounded-candidate omission
by shape and reason. Whole-history evidence no longer enumerates every omitted source ID, so consumers that relied
on that unbounded list must use authorized Camp history operations and the frozen count/envelope instead.

The Manifest version and Native Binding compatibility digest change, so the clean break rotates the technical
Binding/Session once. This is a contract cutover, not an identity edit and not a change to eligible Bootstrap
boundaries or accepted-ACK semantics.

## Rejected Alternatives

- Keeping every whole-history ID inline was rejected because it makes evidence and frozen Delivery state
  unbounded and duplicates the same list per recipient.
- Replacing every omission class with aggregates was rejected because bounded reference and budget failures can
  retain exact IDs cheaply and those IDs provide useful audit evidence.
- Treating a sequence envelope as a `camp.read` range locator was rejected because no such canonical operation
  schema exists and the envelope may contain gaps.
- Retaining a ContextManifest v8 compatibility reader was rejected because the application is pre-release and the
  clean break explicitly removes obsolete technical delivery state.

## References

- [v0.52 overview](../versions/v0.52/README.md)
- [ContextManifest Evidence v9](../contracts/context-manifest-evidence-v9.md)
- [ADR-0147](0147-lossless-model-context-projection-and-layered-delivery-evidence.md)
- [Context Delivery Profile v2](../contracts/context-delivery-profile-v2.md)
