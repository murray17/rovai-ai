---
document_type: adr
id: ADR-0148
title: Read-Only Diagnostics and Data-Minimized Export
status: accepted
date: 2026-08-09
decision_scope: cross-version
source_version: v0.51
supersedes: []
superseded_by: null
---

# ADR-0148: Read-Only Diagnostics and Data-Minimized Export

## Context

The former Diagnostics Settings page combined cached health facts with a button that ran Runtime discovery.
That made “check” ambiguous: reading the current state could also rescan PATH and schedule deeper Runtime work.
Skill projection truth was available only through reconciliation, MCP reads could initialize a missing file, and
SQLite health only proved that Core had already opened the database. The v4 export was assembled from broad raw
objects and included absolute application, Runtime and project paths.

A repair center must distinguish observation from mutation. It must also remain available only after normal Core
startup; a database that prevents Core startup continues through Startup Recovery instead of a second partial Core.

## Decision

### Strict read boundary

`diagnostics.check` is a typed Core read model. It may read Core metadata, filesystem metadata, Git version,
`PRAGMA quick_check`, Skill Library and managed-link facts, an existing MCP file, current member Runtime selections,
and cached Runtime discovery/probe evidence. It must not reconcile Skill projections, initialize or rewrite MCP,
rescan Runtime discovery, schedule a Runtime check, alter SQLite, log in, replace a Runtime, or execute another
repair.

The read model reports every check as `ok | attention | unknown`. An incomplete, timed-out or transient observation
is `unknown`; it is never promoted to an actionable failure. Last-success Runtime evidence may be retained only with
an explicit stale marker and the failed current attempt. All Product Runtimes remain visible, but an unavailable
Runtime is `attention` only when at least one non-removed AgentProfile persistently selects that AdapterKind.

### Explicit single-item repair boundary

Repair is a separate user action and is limited to existing safety-preserving operations:

- Skill reconciliation manages only Rovai-owned projections and preserves project-owned conflicts;
- MCP permission repair may only tighten the parent/file permissions and cannot change JSON bytes;
- Runtime retry explicitly schedules one product check, while hard unavailable states navigate to Runtime settings;
- SQLite and other data failures provide explanation and diagnostics export, never automatic mutation.

There is no “repair all”. A repair is not presented as successful until a subsequent `diagnostics.check` reports
the affected check as `ok`. Failed refresh preserves the last successful report as Recovery evidence.

### Diagnostics export v5

`rovai-diagnostics-v5` is the only newly emitted diagnostics format and locally replaces the v4 identifier listed
in ADR-0048. There is no dual-write or v4 compatibility branch. The export is built from the typed diagnostics
report plus allowlisted aggregate counts, then passes through one centralized redaction boundary before Electron
writes it atomically with mode `0600`.

The export excludes credentials, tokens, cookies, login data, user messages, Memory bodies, attachment bodies and
Tool output. It also emits no absolute Home, application data, SQLite, Runtime executable, Skill entry, execution
root, workspace or project paths. Finder reveal accepts only the exact path successfully exported in the current
Main process session.

## Consequences

- “Run full self-check” has a stable no-write meaning and can be regression-tested independently from repair.
- Diagnostics can honestly show Partial and Recovery states without turning missing evidence into failure.
- Skill and MCP require dedicated strict-read paths in addition to their existing mutation APIs.
- Export consumers must adopt v5; v4 is intentionally not emitted or translated.
- Core-start database failures remain outside the Diagnostics Center and continue through Startup Recovery.

## Rejected Alternatives

- Reconcile Skill or initialize MCP as part of self-check: observation would mutate the condition being diagnosed.
- Rescan or probe every Runtime during self-check: it would make the read path slow, externally observable and
  semantically different from cached evidence.
- Mark every missing Runtime as a problem: unused products would create noise and pressure users to install tools
  they do not use.
- Keep v4 beside v5: broadens the privacy surface and prolongs an unneeded raw-object contract.
- Automatically rebuild SQLite or overwrite malformed MCP: risks destructive recovery without enough authority.

## References

- [v0.51 诊断中心](../versions/v0.51/README.md)
- [Diagnostics Center v1 contract](../contracts/diagnostics-center-v1.md)
- [Diagnostics Center architecture](../architecture/diagnostics-center.md)
- [ADR-0048](0048-rovai-product-identity-and-legacy-namespace.md)
