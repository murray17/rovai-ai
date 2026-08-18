---
document_type: adr
id: ADR-0210
title: Platform-Qualified Product Runtime Admission
status: accepted
date: 2026-08-18
decision_scope: cross-version
source_version: v1.05
supersedes: []
intended_supersedes: []
superseded_by: null
---

# ADR-0210: Platform-Qualified Product Runtime Admission

## Context

The Product Runtime Catalog is a closed set of globally integrated Adapter identities, while Product Runtime
Availability describes discovery and verification on one machine. Adding Windows without another authority would
either present every catalog entry as supported before it has Windows evidence, or overload machine availability with
a product-support conclusion. Testing one representative process shape also cannot qualify every Adapter's discovery,
authentication, session, approval, cancellation, Built-in Tool and shutdown behavior.

## Decision

Rovai adds **Runtime Platform Admission** between Product Runtime Catalog and Product Runtime Availability. Admission is
the product-level decision for one exact `AdapterKind × HostPlatformKey`; the platform key includes OS family and CPU
architecture. The Rust Adapter Registry is its sole source of truth, and TypeScript consumes a Core projection rather
than maintaining another matrix.

Admission has exactly three states: `qualified`, `not_qualified`, and `unsupported`. Its reason is a closed stable code,
and every `qualified` entry names a digest-bound evidence revision. OS-version and storage-volume eligibility are host
admission facts checked separately; `windows-x64` never implies that an unsupported Windows release, network volume, or
WSL environment is eligible.

Only `qualified` entries may enter automatic discovery, availability checks, managed installation creation,
Onboarding selection, Member Runtime selection, migration defaults, dispatch or diagnostics that execute a Runtime.
`not_qualified` is presented as “Windows 尚未验证”; `unsupported` is presented as an upstream/product unsupported
conclusion. Neither is rendered as `not_installed`, `probe_failed`, or another machine-availability state.

An existing configuration that references an unqualified platform entry remains readable and may be preserved byte for
byte while unrelated Member fields are saved. It cannot be changed, re-saved as a newly selected Runtime, or executed;
dispatch fails with `runtime_platform_not_qualified`. This preservation rule must not turn one historical Runtime value
into a blanket blocker for unrelated profile edits.

Qualification is per Adapter. Shared ACP, stdio, or one-shot execution shape evidence only qualifies platform
infrastructure; each selectable Runtime independently proves the matrix required by the current contract. Settings-only
preview identities remain outside both Product Runtime Catalog and Runtime Platform Admission.

This decision locally refines ADR-0065, ADR-0066 and ADR-0189 without replacing their catalog, availability, preview,
frozen-Run or no-fallback boundaries.

## Consequences

- A Product Runtime can remain a valid macOS catalog member while honestly unavailable for selection on Windows.
- Core, Contracts, Renderer and migration code gain a fourth authority and must keep its meaning distinct from machine
  availability.
- Windows support expands Adapter by Adapter only after reproducible evidence; protocol similarity cannot create a
  support claim.
- Existing unqualified configurations remain inspectable without silently granting new execution authority.

## Rejected Alternatives

- **Add `not_qualified_on_windows` to Product Runtime Availability.** It would mix product admission with machine facts.
- **Keep a TypeScript-only Windows allowlist.** Renderer presentation cannot own execution authority.
- **Qualify one Runtime per execution shape.** Adapter-specific authentication, continuation and cleanup remain unproven.
- **Use `win32` as the key.** It conflates native x64, ARM64 and WSL conclusions.
- **Block every edit to a profile containing historical unqualified configuration.** It prevents unrelated corrections
  without improving execution safety.

## References

- [v1.05 Windows x64 scope](../versions/v1.05/README.md)
- [Runtime Platform Admission v1](../contracts/runtime-platform-admission-v1.md)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [ADR-0065: Verified Runtime Catalog](0065-verified-runtime-catalog-and-documentation-only-compatibility.md)
- [ADR-0066: Managed Product Runtime Resolution](0066-managed-product-runtime-resolution.md)
- [ADR-0189: Settings-Only Runtime Preview](0189-settings-only-runtime-preview-outside-product-catalog.md)
