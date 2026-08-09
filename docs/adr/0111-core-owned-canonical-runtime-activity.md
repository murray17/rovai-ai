---
document_type: adr
id: ADR-0111
title: Core-Owned Canonical Runtime Activity and Observation-Honest Lifecycle Projection
status: accepted
date: 2026-08-05
decision_scope: cross-version
source_version: v0.41
supersedes: []
superseded_by: null
---

# ADR-0111: Core-Owned Canonical Runtime Activity and Observation-Honest Lifecycle Projection

## Context

Rovai-ai must present comparable execution activity across different Agent Runtimes without
claiming facts that a Runtime did not report. The product therefore separates provider evidence,
Core-owned semantic activity, lifecycle projection, and Renderer presentation; this gives v0.41 a
stable architectural seam for incremental Runtime mappings.

This decision was explored during the v0.40 design track and formally adopted when v0.41 became the
current version. The v0.40 history remains a frozen implementation snapshot.

## Decision

### Four explicit layers

1. **Runtime Evidence** remains append-only evidence of a Runtime-reported event or a fact from a
   Core-intervened operation. It retains source identity and is never expanded into an inferred
   operation.
2. **Canonical Runtime Activity** is a versioned, Core-owned semantic model for one observed
   operation. It carries an `operationId`, capability classification, optional semantic intent,
   phase, outcome, source-Evidence references, and an explicit observation/credibility boundary.
3. **Lifecycle Projection** deterministically merges the activity's started, progress, and terminal
   facts by `operationId`. Live updates and recovery reads must produce the same projection; raw
   Evidence remains intact.
4. **Activity Presentation** is Renderer-only. It localizes title, details, status, disclosure and
   visual treatment, but never reclassifies from a provider title, command string, Runtime name or
   untrusted field.

### Classification authority

`CanonicalActionInput` is not a universal presentation taxonomy. It may contribute classification
only when Core actually scheduled or intervened in the operation, or when a Runtime's structured
report is cryptographically/structurally bound to that Action. It supplements an observed fact and
never broadens it into knowledge of unreported Runtime internals.

`canonicalTool` has semantic priority only when `sourceAuthority` is `core` and the name validates
against the current Rovai Tool Catalog. A Runtime-provided or otherwise untrusted value is retained
as a hint/diagnostic field and cannot determine the Canonical Runtime Activity.

### Observation honesty

Runtimes that currently expose only Run-level or final-output facts, such as Claude Code and
Antigravity, produce Run lifecycle activity and final responses only. A workspace diff may be
reported as a separate observation, but it cannot be used to reconstruct a command, file operation,
or other hidden Runtime step.

## Consequences

- A new Runtime mapping can be added at the Core semantic seam without adding Renderer-specific
  title heuristics or a second UI taxonomy.
- Provider protocol richness and product-facing semantics can evolve independently while source
  Evidence remains auditable.
- Unknown or insufficiently observed operations remain explicitly unknown instead of being mislabeled
  as Shell commands.
- v0.41 still needs a versioned activity taxonomy, adapter mapping registry, fixture corpus,
  lifecycle replay tests, and a policy for revising classifications without rewriting historical
  observations.

## Rejected Alternatives

- Letting Renderer infer activity from command strings, provider titles, or Runtime names.
- Treating `CanonicalActionInput` as the universal cross-Runtime activity taxonomy.
- Inferring hidden operations from final workspace changes.
- Maintaining a separate bespoke activity vocabulary for each Runtime.

## References

- [ADR-0112: Immutable Execution Evidence and Rebuildable Versioned Canonical Activity Projection](0112-immutable-execution-evidence-and-rebuildable-canonical-activity-projection.md)
- [ADR-0113: Core-Scoped Operation Identity and Evidence Deduplication Boundary](0113-core-scoped-operation-identity-and-evidence-deduplication-boundary.md)
- [ADR-0114: Stable Activity Domain and Evidence-Bounded Semantic Kind](0114-stable-activity-domain-and-evidence-bounded-semantic-kind.md)
- [ADR-0115: Evidence-Bounded Activity Phase and Outcome Resolution](0115-evidence-bounded-activity-phase-and-outcome-resolution.md)
- [ADR-0116: Projection-Pinned Classifier Version and Explicit Historical Reprojection](0116-projection-pinned-classifier-version-and-explicit-historical-reprojection.md)
- [ADR-0117: Observation-Capability Coverage Levels Across Runtime Adapters](0117-observation-capability-coverage-levels-across-runtime-adapters.md)
- [ADR-0118: v0.41 Local Data Clean Break and Managed Reset Boundary](0118-v041-local-data-clean-break-and-managed-reset-boundary.md)
- [ADR-0059: Runtime-Owned Resource Permissions](0059-runtime-owned-resource-permissions.md)
- [ADR-0061: Durable User-Visible and Agent-Inaccessible Execution Evidence](0061-durable-agent-inaccessible-execution-evidence.md)
