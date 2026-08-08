---
document_type: adr
id: ADR-0138
title: Durable Bootstrap Redelivery Requirement and Accepted-Input Acknowledgement
status: accepted
date: 2026-08-08
decision_scope: cross-version
source_version: v0.48
supersedes: []
superseded_by: null
---

# ADR-0138: Durable Bootstrap Redelivery Requirement and Accepted-Input Acknowledgement

## Context

A Runtime may compact the ordinary context of an existing Native Session after its Bootstrap was
delivered. Compaction notification and the next Rovai-controlled prompt are asynchronous. A Boolean
stored inside an Adapter cannot survive Core restart and cannot distinguish a redelivery already
selected for an in-flight input from another compaction observed before that input is accepted.

For example, clearing one `pending` Boolean after calling the Runtime would lose a second compaction
that arrives between Delivery Gate selection and Runtime acknowledgement. Clearing on a successful
send call would also overstate an input whose delivery later becomes `delivery_unknown`.

Rovai already treats Runtime input as a durable `prepared | accepted | delivery_unknown` protocol and
advances the Accepted Public Context Boundary only after accepted acknowledgement. Bootstrap
redelivery needs the same recovery standard without making Adapter process memory a competing truth.

## Decision

Bootstrap Redelivery Requirement is durable Core state scoped to one Native Binding identity and
generation. Product language may derive `clean | pending_redelivery`, but the authoritative state is
a pair of monotonic requested and acknowledged redelivery revisions.

An eligible, correctly fenced compaction observation advances the requested revision. A Bootstrap
Delivery Gate selects the currently requested revision and freezes that selected revision on the
corresponding Runtime Input Delivery. It does not acknowledge or clear the requirement.

Only the transaction that records the Runtime Input Delivery as `accepted` may advance the
acknowledged revision, and it may advance only through the revision frozen on that delivery. A send
failure, `delivery_unknown`, process loss or Core restart does not consume the requirement.

If another eligible observation arrives after the Gate selected a revision, its later revision remains
pending when the earlier input is acknowledged. A signal belonging to a replaced Native Binding,
another generation, a stale Host/Session route or a fenced execution identity cannot mutate the
current requirement.

This decision owns delivery accounting only. Runtime classification, detector success semantics,
Bootstrap composition and event-deduplication identity are separate v0.48 decisions and must preserve
this acknowledgement boundary.

## Consequences

- Crash recovery cannot silently forget an observed need for Bootstrap restoration.
- Runtime Input Delivery becomes the atomic bridge between a pending requirement and its consumption.
- Persistence needs monotonic revision fields or an equivalent ledger plus a delivery-side captured
  revision; a single persisted Boolean is insufficient.
- Adapter callbacks must carry enough trusted Binding/Host identity for Core to fence stale signals.
- `delivery_unknown` recovery must reconcile the original input before any new delivery can consume the
  same or a later requirement.

## Rejected Alternatives

- Adapter-local `clean | pending` state: loses requirements on Core or Host restart and creates a second
  authority outside Core.
- Clear immediately before or after calling the Runtime: loses failed or ambiguous deliveries.
- Clear the current Boolean on ACK: can erase a newer observation that arrived after Gate selection.
- Treat every pending observation as a new user task or Camp Message: changes collaboration semantics
  and duplicates Session-recovery context into public history.

## References

- [v0.48 Native Session Compaction Bootstrap Redelivery](../versions/v0.48/README.md)
- [ADR-0001: Core Transaction](0001-core-transaction.md)
- [ADR-0067: Native Session Bootstrap and AgentRun Context v3](0067-native-session-bootstrap-and-agentrun-context-v3.md)
- [ADR-0100: Latest Member Identity in Native Session Bootstrap](0100-latest-member-identity-native-session-bootstrap.md)
- [ADR-0139: Version-Owned Bootstrap Redelivery Runtime Policy](0139-version-owned-bootstrap-redelivery-runtime-policy.md)
