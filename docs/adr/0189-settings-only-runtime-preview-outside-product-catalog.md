---
document_type: adr
id: ADR-0189
title: Settings-Only Runtime Preview Outside the Product Catalog
status: accepted
date: 2026-08-15
decision_scope: cross-version
source_version: v0.83
supersedes: []
superseded_by: null
---

# ADR-0189: Settings-Only Runtime Preview Outside the Product Catalog

## Context

ADR-0065 and ADR-0066 deliberately made the Product Runtime Catalog identical to the closed set of
Adapters that can freeze and execute an AgentRun. This prevents a candidate from acquiring a false
health state, member selection, persisted binding, or execution promise.

Rovai also needs a narrowly scoped way to tell users, on the Runtime settings surface itself, that a
recognizable product integration is planned. Treating that communication as a Product Runtime entry
would violate the verified admission boundary; keeping every preview outside the product would prevent
the requested settings-level communication. The two sets therefore need distinct authority and behavior.

## Decision

1. The executable Product Runtime Catalog remains the compile-time closed `AdapterKind` registry. Only
   entries with an implemented Adapter, deep Probe, frozen AgentRun configuration, and required evidence
   may enter it.
2. Runtime settings may additionally render a static, presentation-only Runtime Preview Catalog. A
   preview is not an `AdapterKind`, Installation, availability/readiness state, member option, diagnostic
   subject, migration value, or execution capability.
3. Every preview must be explicitly labeled as pending/unsupported, expose no probe, configuration,
   selection, repair, or execution action, and remain absent from every ordinary surface other than the
   Runtime settings catalog. A logo or product name does not imply admission.
4. Core and Contracts do not receive preview identities. Renderer code must combine supported rows and
   preview rows only after the supported Product Runtime projection has been received.
5. Promotion requires the normal verified Runtime admission work. It removes the preview and adds a new
   Product Runtime entry through Adapter, Contract, Migration, Probe, AgentRun, Activity, compatibility,
   and UI changes; no preview state or identity is reinterpreted as persisted product data.

This decision locally replaces only ADR-0065/ADR-0066's prohibition on any candidate visibility in the
Runtime settings UI. Their closed executable catalog, evidence, readiness, persistence, and no-fallback
rules remain unchanged.

## Consequences

- Users can see an honest “pending support” signal without gaining a control that cannot succeed.
- Product Runtime counts, diagnostics and member choices remain machine-derived from `AdapterKind`; a
  Renderer preview cannot accidentally become execution state.
- Each preview adds a small manually reviewed UI/asset maintenance cost and must be removed during
  promotion rather than silently changing meaning.
- Other pages, marketing claims and compatibility conclusions cannot infer support from preview presence.

## Rejected Alternatives

- **Add a disabled AdapterKind:** this would expand Contracts, Migration, health and selection exhaustiveness
  for an identity that cannot execute.
- **Return previews from Core:** this would make a presentation roadmap part of the Runtime domain contract.
- **Show previews in member selection or diagnostics:** disabled controls would still imply a configurable
  or checkable product and conflate pending intent with current readiness.
- **Keep all candidates documentation-only:** safe, but does not meet the explicit settings-level product
  communication need this decision addresses.

## References

- [v0.83 TRAE CLI CN Runtime](../versions/v0.83/README.md)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [ADR-0065: Verified Runtime Catalog](0065-verified-runtime-catalog-and-documentation-only-compatibility.md)
- [ADR-0066: Managed Product Runtime Resolution](0066-managed-product-runtime-resolution.md)
