---
document_type: adr
id: ADR-0158
title: Default-All Runtime Delivery for Managed Skills
status: accepted
date: 2026-08-11
decision_scope: cross-version
source_version: v0.58
supersedes: []
superseded_by: null
---

# ADR-0158: Default-All Runtime Delivery for Managed Skills

## Context

Rovai installs official and user-imported Skills enabled but historically creates no Skill Group Assignment. A user can
explicitly request an installed workflow by name while the selected Agent Runtime cannot discover its managed Revision,
because Library availability alone does not create a project-native projection. This causes the Runtime to search only
independently owned native Skill locations even though the Settings library presents the Skill as installed and active.

Skill Group Assignment remains the correct delivery authority: Runtime-native discovery paths differ, overlapping
Groups require explicit saved intent, and ContextManifest must freeze actual exposure rather than claim prompt-level
injection. The default policy therefore needs to change without replacing native projection with a second prompt
protocol or removing the user's ability to pause and customize delivery.

## Decision

Every newly installed Rovai-managed Skill, whether official or user-imported, starts enabled and receives an Assignment
for all nine fixed Skill Delivery Groups: `codex`, `opencode`, `copilot`, `claude_compatible`, `antigravity`, `kiro`,
`qoder`, `codebuddy`, and `qwen`.

Existing installations perform one migration that inserts every missing Group Assignment for every active Skill.
The migration preserves each Skill's current Revision identity and explicit enabled/disabled state. After that one-time
transition, user changes remain authoritative: removing a Group or disabling a Skill is not reversed on a later
application start, bundled Revision check, or imported-Skill update. A newly introduced official Skill and a newly
imported Skill receive the complete default set when first installed, while publishing a later bundled or imported
Revision only advances the Assignments that still exist.

Selecting all Groups is application-global intent, not nine mandatory physical copies. Effective Skill Delivery keeps
using the minimal projection set for the Runtime Groups discoverable from a Run Workspace, including existing overlap,
shadow, active-Run stability, and stale-revision rules. Rovai continues to avoid `.agents/skills`, never overwrites
Runtime-native content, and records actual per-Run exposure in ContextManifest.

Default delivery does not inject full Skill content into Rovai Dynamic Context and does not prove that the
Runtime or model loaded `SKILL.md`. Runtime-native progressive discovery remains responsible for selecting and reading
the Skill. Enablement, Assignment, and Skill instructions grant no filesystem, Git, Tool, collaboration, approval, or
implementation authority.

This decision locally replaces the default-unassigned clauses in ADR-0105 and ADR-0150. Their Library identity,
immutable Revision, explicit Assignment, safe projection, conflict, exposure, official inventory, naming, packaging,
and workflow-specific decisions remain in force.

## Consequences

Installed workflows are discoverable by default across every supported Runtime without requiring a second settings
step. New AgentRuns can freeze a ready Skill exposure whenever the selected Runtime and execution root support the
assigned Group, while disabled, shadowed, stale, or errored delivery remains explicit.

The one-time migration intentionally expands prior Group selections because the old empty or partial state
cannot distinguish inherited defaults from a deliberate user choice. Users can remove unwanted Groups after migration,
and those removals persist. User-imported content therefore becomes eligible for Runtime-native discovery immediately
after import; it remains non-executing library content until a Runtime selects it and still grants no authority.

All-groups Assignment increases the number of configured relationships and possible project-native projections, but
overlap minimization and on-demand execution-root reconciliation avoid redundant links. Tests and UI documentation must
show the same default-all policy for both origins while preserving their identity, update, and deletion differences.

## Rejected Alternatives

- Keep new Skills unassigned: rejected because installed workflows remain unavailable until users discover a separate
  delivery setting, even when they invoke the Skill explicitly.
- Reapply all Assignments at every startup: rejected because a default must not erase later user choices.
- Apply the default only to official Skills: rejected because installed-and-enabled behavior should be consistent for
  imported Skills and native conflict handling already fails safely without overwriting existing entries.
- Inject Skill bodies into every AgentRun prompt: rejected because it bypasses native progressive discovery,
  duplicates the Skill protocol, consumes context unconditionally, and weakens exposure evidence.

## References

- [v0.58 overview](../versions/v0.58/README.md)
- [ADR-0105: Runtime-Group Assigned Rovai Skill Delivery](0105-runtime-group-assigned-skill-delivery.md)
- [ADR-0150: Evidence-First Agent Codebase Analysis Bundled Skill](0150-evidence-first-agent-codebase-analysis-bundled-skill.md)
- [Skill settings UI strategy](../../apps/desktop/.impeccable/surfaces/settings-workspace.md)
- [Domain terminology](../../CONTEXT.md)
