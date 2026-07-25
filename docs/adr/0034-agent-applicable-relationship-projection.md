---
document_type: adr
id: ADR-0034
title: "Agent-Applicable Relationship Projection"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0035
---

# ADR-0034: Agent-Applicable Relationship Projection

## Context

ADR-0023 makes every Relationship pair transparent to the user and both AgentProfiles while
using Direction only to express whose behavior a Memory addresses. Rendering the complete pair
into both Agents' default files would nevertheless present `directed(B → A)` to A as routine
guidance even though it applies to B. Visibility and default applicability therefore need separate
read views.

ADR-0032 also requires Memory Guide to stay short and expose live projections for native
file-tool reads. Listing one exact Relationship file path per Camp member would make Guide and
ContextManifest path lists grow with Camp size even though the Agent can enumerate a directory
with its existing Runtime tools.

## Decision

For an AgentRun whose current AgentProfile is A in Camp C, Memory Guide exposes:

- one Hearth Projection file;
- one Companion(A) Projection file;
- one live Relationship Projection Directory specific to `(C, A)`.

The Guide provides the exact directory root and its meaning; it does not enumerate child files.
ADR-0032's exposed path list therefore contains the Relationship directory root as one location.
ContextManifest freezes that root, not the directory's child-file list or contents. The directory
is a disposable live projection and never a per-Run copy.

For each other current member B of Camp C, A's default pair view contains only active:

```text
mutual(A, B)
directed(A → B)
```

It excludes `directed(B → A)` and does not automatically add Relationship pairs outside Camp C.
This is applicability filtering, not an ACL. The user-facing management view retains the complete
unordered pair, and both pair members remain authorized to inspect or search either direction
explicitly under ADR-0023.

Projection files remain derived from authoritative SQLite state and cannot be edited back into
Memory. Exact physical directory names, child filenames, empty-view behavior, directory digest
format and reconciliation mechanics are version protocol details, provided they preserve this
selection boundary.

## Consequences

- A receives only Relationship guidance that applies mutually or to A's own behavior by default.
- B's one-way obligations are not duplicated into A's routine context, while neither direction
  becomes a hidden dossier.
- Memory Guide remains bounded to a Relationship directory root instead of growing by one path
  per Camp member.
- Runtime Agents must enumerate or search the exposed directory before choosing a pair file.
- Projector and tests need distinct `(Camp, AgentProfile)` Relationship views in addition to the
  complete pair representation used by user management.
- Camp membership and live Memory changes can alter directory contents without rewriting the
  frozen Guide; a completed prompt remains reproducible, while later native reads remain live.

## Rejected Alternatives

- Rendering both directed orientations for A: confuses transparency with behavioral
  applicability and wastes reading context.
- Hiding reverse-directed content from A everywhere: turns Direction into an ACL and violates
  pair transparency.
- Listing every pair file in Memory Guide: makes prompt and manifest path data scale with Camp
  size.
- Exposing one global directory containing A's pairs outside the current Camp: introduces
  unrelated collaborators into the Run's default memory surface.
- Creating a per-Run directory snapshot: restores immutable reads at the cost of copies and
  cleanup already rejected by ADR-0032.

## References

- [v0.10 长期记忆](../versions/v0.10/README.md)
- [ADR-0019: Application-Global Memory Ownership](0019-application-global-memory-ownership.md)
- [ADR-0023: Transparent Relationship Direction](0023-transparent-relationship-direction.md)
- [ADR-0032: User-Authorized Live Memory Projection](0032-user-authorized-live-memory-projection.md)
