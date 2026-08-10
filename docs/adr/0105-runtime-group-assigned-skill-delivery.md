---
document_type: adr
id: ADR-0105
title: "Runtime-Group Assigned Rovai Skill Delivery"
status: accepted
date: 2026-08-04
decision_scope: cross-version
source_version: v0.37
supersedes: [ADR-0017]
superseded_by: null
---

# ADR-0105: Runtime-Group Assigned Rovai Skill Delivery

> 后续局部规范：[ADR-0144](0144-self-contained-duo-grilling-bundled-skills.md) 规定当前四个
> 官方 Skill、自包含依赖与仓库顶层 `skills/` 源码目录；本文的 `rovai-` 前缀、默认启用且
> 未分配以及其余投递语义继续有效。

## Context

Rovai supports Agent Runtimes whose project-native Skill discovery directories are different and
sometimes overlap. A Member-level Skill view cannot provide reliable isolation because concurrent
Members and long-lived Native Sessions can share one execution root. The previous global-enabled
projection through `.agents/skills` also conflated Library availability with Runtime selection,
treated an interoperability directory as Rovai-owned, and could not express that OpenCode or
Copilot may discover both their product directory and `.claude/skills`.

Runtime-native Skills remain independently owned by their Runtime or user. Rovai cannot inventory
or choose a winner between a Runtime-native Skill and a same-named Rovai Skill. At the same time,
users need explicit application-global configuration, immutable updates, safe non-overwrite
behavior, and an honest per-Run record of what was physically visible.

## Decision

### Library identity and revisions

The Rovai Skill Library contains only official Rovai Skills and Skills the user explicitly imports.
`Skill.name` is globally unique inside that Library. A Skill has `origin = official | imported`, an
application-global enablement state, and one current immutable `SkillRevision`.

Importing local content or GitHub content with the same name as an imported Skill creates a new
Revision of that Skill. Different sources never create parallel same-name Library identities;
source details belong to Revision metadata. An import with an official name is rejected. A user who
needs a distinct Skill must change its manifest name first.

Local-folder and GitHub imports copy the complete selected directory into the managed Revision
store. GitHub imports accept a repository, optional subdirectory, and branch, tag, or commit ref.
Runtime execution never depends on the source directory or temporary checkout.

The only official Skill is `rovai-memory-stewardship`. Official names use the `rovai-` prefix. It is
installed enabled but without any Delivery Group Assignment. Every newly imported Skill likewise
starts enabled and unassigned.

### Enablement and assignment

`Skill.enabled` is a global delivery pause, not the assignment identity and not a permission grant.
Disabling a Skill preserves every Assignment and suspends all Rovai-managed projection. Assignments
remain editable while the Skill is disabled; re-enabling restores delivery from the saved set.

`SkillGroupAssignment(group_key, skill_id, revision_id)` is the explicit application-global intent.
Its existence means the current Revision is selected for that Delivery Group; deleting it means the
Group is no longer selected. Publishing a new imported or official Revision advances existing
Assignments to the new immutable Revision. The initial Assignment table is empty.

Rovai defines nine fixed Delivery Groups:

| Key | Project-native directory |
|---|---|
| `codex` | `.codex/skills` |
| `opencode` | `.opencode/skills` |
| `copilot` | `.github/skills` |
| `claude_compatible` | `.claude/skills` |
| `antigravity` | `.agent/skills` |
| `kiro` | `.kiro/skills` |
| `qoder` | `.qoder/skills` |
| `codebuddy` | `.codebuddy/skills` |
| `qwen` | `.qwen/skills` |

Each `AgentRuntimeAdapter` declares the Groups it can discover and whether that declaration has
been runtime-verified or is documentation-only. OpenCode discovers `opencode` and
`claude_compatible`; Copilot discovers `copilot` and `claude_compatible`. A Group's Member list is a
read-only live view derived from current Agent Profiles and Runtime selections. It is never stored
in the Assignment and empty Groups remain visible.

### Safe projection and overlapping discovery

Rovai projects individual symbolic links from the central immutable Revision store into an
execution root only for Groups required by a Runtime in that root. Rovai never projects through,
enumerates, imports, deletes, or modifies `.agents/skills`.

An existing link to the same Rovai Revision is reused. A Rovai-owned old-Revision link is switched
only when no active Run that can discover that Group is using the execution root. Removal follows
the same active-Run protection. Other roots and unrelated Groups may reconcile independently.

If the exact target is an ordinary directory, file, or non-Rovai link, Rovai leaves it unchanged and
records `shadowed`. A same-name entry at another known unmanaged discovery location is a positive
best-effort `duplicate_visible` observation. Rovai does not scan Runtime-native Skill inventories,
does not infer absence from a negative check, and does not claim which copy the Runtime uses.

Explicit Assignments are retained even when Runtime discovery overlaps. Physical projection is the
minimum set that satisfies those Assignments: a healthy selected `.claude/skills` entry can satisfy
selected OpenCode or Copilot delivery without redundant product-directory links. If that shared
entry becomes shadowed, Rovai falls back only to the Runtime-specific Group that the user also
explicitly selected; it never invents an unselected fallback.

There is no Prompt Skill fallback protocol. Documentation-only Groups remain configurable and are
shown as “暂未验证” until Adapter tests prove the capability.

### Run stability and presentation

An active AgentRun never switches Revision or loses a projection it can still read. A configuration
change is deferred for that root and relevant Group. A new Run does not wait for the older Run to
drain; if the old projection is still physically visible, the new Run records and uses that actual
stale exposure. `ContextManifest` freezes Skill identity, Revision, configured Group, actual delivery
Group and path, status, and observed conflicts. This is an exposure fact, not proof that a Runtime
or model read the Skill body.

Settings retains the existing Rovai App shell and sidebar. Its Skill content has two regions:
local/GitHub addition at the top and a searchable tofu-grid Library below. Each Skill card owns its
enable switch, Revision/source details, and multi-select Delivery Group control. The selector shows
all nine Groups, verification state, Runtime mapping, and the current derived Members. Settings does
not show Camp or project delivery health. Per-Run delivery state appears in the Camp Context
inspector as “Skill 投递”.

## Consequences

- Users can pause delivery without losing a carefully selected Group set.
- Library identity and import-update behavior remain simple and globally unique.
- Rovai no longer depends on or takes ownership of the shared `.agents/skills` convention.
- Overlapping Runtime discovery is explicit in saved intent but avoids redundant filesystem links.
- Runtime-native duplicates remain safe and honest but intentionally unresolved.
- One execution root still cannot provide different Revision views to concurrent Runs that discover
  the same Group; active-Run stability therefore defers changes instead of promising Member isolation.
- Documentation-only Groups require ongoing Adapter-level verification and may not work until that
  evidence exists.

## Rejected Alternatives

- Member-level Skill views: rejected because shared execution roots and Native Sessions do not
  preserve Member isolation.
- A single global enable switch with implicit all-Runtime projection: rejected because it cannot
  express Runtime selection.
- Rovai-managed `.agents/skills`: rejected because Runtime-native ownership and discovery overlap
  must remain outside Rovai control.
- Persisted Group membership: rejected because Members and Runtime selections change independently
  of application-global Skill configuration.
- Deleting Assignments on disable: rejected because pause and selection have different lifecycles.
- Overwriting or importing Runtime-native Skills: rejected because Rovai lacks ownership and cannot
  determine the Runtime's conflict winner.
- Prompt injection for unsupported discovery: rejected because it creates a second Skill protocol
  with different semantics.

## References

- [ADR-0150: Evidence-First Agent Codebase Analysis Bundled Skill](0150-evidence-first-agent-codebase-analysis-bundled-skill.md)
- [ADR-0017: Managed Skill Library and Runtime-Native Projection](0017-managed-skill-library-runtime-projection.md)
- [Arctic Dawn UI contract](../ui/arctic-dawn.md)
- [Domain terminology](../../CONTEXT.md)
