---
document_type: adr
id: ADR-0127
title: Atomic Member Runtime Configuration and Internal Resolved Binding
status: accepted
date: 2026-08-06
decision_scope: cross-version
source_version: v0.43
supersedes:
  - ADR-0082
superseded_by: null
---

# ADR-0127: Atomic Member Runtime Configuration and Internal Resolved Binding

## Context

ADR-0082 made model and permission parameters explicit but retained an unresolved, adapter-only
Product Runtime Selection as a valid persisted state. Public AgentProfile contracts consequently
exposed both selection/preference records and Runtime Readiness, including an internal Installation
identity. That creates two configuration models and lets background Runtime resolution appear able
to complete a Member configuration that the user never atomically confirmed.

The product contract needs one answer to “what Runtime configuration did this Member save?” while
Core still needs a separate launch-time binding containing managed Installation evidence.

## Decision

### Member configuration is complete or absent

`MemberRuntimeConfiguration` is the only persisted and publicly projected Member Runtime value. It
contains Product Runtime, model policy and Adapter-native permission configuration as one atomic
value. The version-checked save command accepts all three components together and succeeds only
when Core can validate them against a ready Managed Default Installation and its current capability
snapshot.

An adapter-only choice is editor draft state, not durable Member state. If Installation discovery,
authentication, probing or capability validation is incomplete, the save rejects without changing
the prior configuration. A Member with no successful complete save has no Runtime configuration and
projects `runtime_not_configured`.

Background discovery and refresh may update Installation and capability evidence, but never create,
complete or repair a Member Runtime Configuration. Capability drift may change Runtime Readiness to
`needs_attention`; it never rewrites the saved value.

### Resolved binding is internal execution state

Core resolves a complete Member Runtime Configuration to an internal `ResolvedRuntimeBinding` that
may contain AdapterInstallation ID and other launch evidence. It is used for dispatch, diagnostics
and frozen Run Runtime Configuration, not for ordinary AgentProfile reads or Member edits.

The public AgentProfile projection contains only optional `runtimeConfiguration` and
`runtimeReadiness`. Installation identity, executable path, discovery provenance and fingerprints
remain in Installation/diagnostic boundaries.

This replaces ADR-0082's unresolved-selection exception and public preference model, and locally
replaces ADR-0066 clauses that treated an AdapterKind-only Product Runtime Selection as the durable
ordinary Member configuration. ADR-0066's managed discovery, relocation and Installation ownership
continue to apply internally.

### Clean break

The current projection schema resets Rovai-owned local data rather than translating partial Runtime
preferences. No compatibility field, dual read or automatic completion remains. User projects,
Codex Native Home and external Runtime state are outside the reset boundary.

## Consequences

- Member settings and AgentProfile reads have one configuration shape.
- Runtime availability can be inspected before a configuration can be saved, without persisting a
  partial preference.
- Installation identity stays available to Core and diagnostics without leaking into product DTOs.
- Users must retry an explicit complete save after the selected Runtime becomes available.

## Rejected Alternatives

- Persist AdapterKind while awaiting discovery: recreates a second, incomplete configuration model.
- Expose Installation ID in AgentProfile: mixes product configuration with launch binding evidence.
- Materialize defaults after discovery: changes user configuration without an accepted user command.
- Translate partial historical preferences: preserves the ambiguity this decision removes.

## References

- [ADR-0066: Managed Product Runtime Resolution](0066-managed-product-runtime-resolution.md)
- [ADR-0082: Member-Owned Runtime Parameters](0082-member-owned-runtime-parameters.md)
- [ADR-0118: Local Data Clean Break](0118-v041-local-data-clean-break-and-managed-reset-boundary.md)
- [v0.43 version scope](../versions/v0.43/README.md)
