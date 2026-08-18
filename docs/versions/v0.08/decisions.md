---
document_type: version-decisions
version: v0.08
lifecycle: historical
last_updated: 2026-08-18
---

# v0.08 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0017](#adr-0017) | Managed Skill Library and Runtime-Native Projection | `superseded` |

<!-- legacy-adr:begin id=ADR-0017 source-file-sha256=3f3ff37545c38a92cd9519e2aed7aa6233d9d84bc662f257e2b9cdfd73463f07 -->
<a id="adr-0017"></a>

## ADR-0017: Managed Skill Library and Runtime-Native Projection

迁移时原路径：`docs/adr/0017-managed-skill-library-runtime-projection.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0017
title: "Managed Skill Library and Runtime-Native Projection"
status: superseded
date: 2026-07-24
decision_scope: cross-version
source_version: v0.08
supersedes: []
superseded_by: ADR-0105
```

<!-- legacy-adr-body:begin id=ADR-0017 -->
<a id="adr-0017-context"></a>
### Context

Lumen supports multiple locally installed Coding Agent Runtimes through
`AgentRuntimeAdapter`. Codex, Claude Code, OpenCode, Copilot and Antigravity each discover
directory-shaped Skills through Runtime-native project locations. Users need one Lumen-managed
Skill collection that survives removal of the import source and works in both project Camps and
the no-project Lobby.

Installing into Runtime user-level directories would leak Lumen choices into Agent sessions
started outside Lumen. Linking directly to import sources would make execution depend on mutable
external paths. Injecting every `SKILL.md` into AgentRun prompts would duplicate native discovery,
consume context and incorrectly imply support for Runtimes that do not implement Skills.

The content and exposure boundaries also have different lifecycles. A Skill has a stable identity,
an update creates new immutable content, and each execution root can be Ready, Stale, Shadowed or
Unsupported independently. Project directories may already contain user-owned Skills that Lumen
must never overwrite.

<a id="adr-0017-decision"></a>
### Decision

<a id="adr-0017-canonical-library"></a>
#### Canonical Library

Lumen owns an application-global Skill Library. Metadata and enablement are authoritative in the
existing SQLite database; complete immutable SkillRevision directories are stored under
`~/.lumen/skills`.

Import copies and validates content into Lumen storage. It never retains a dependency on the
source directory and never executes imported content. A content change creates a new Revision;
published Revisions are not edited in place.

“Global” means available to Lumen-managed Agents. Lumen does not install or link Skills into
Runtime user-level locations such as `~/.agents/skills`, `~/.claude/skills` or
`~/.copilot/skills`.

<a id="adr-0017-runtime-native-project-projection"></a>
#### Runtime-native project projection

`AgentRuntimeAdapter` declares its supported native project Skill roots. Lumen persistently
projects each enabled current Revision into the AgentRun execution root using the minimum native
directory set:

```text
.agents/skills   → Codex, OpenCode, Copilot
.claude/skills   → Claude Code
.agent/skills    → Antigravity
```

Project Camps use their project execution root. Lobby Camps use the existing Lumen-owned Lobby
execution root. Lumen creates individual Skill entries and never owns an entire Runtime
configuration directory.

Projection is derived from current Skill state, Adapter requirements and the actual filesystem.
Core reconciles it on lifecycle changes, startup and before AgentRun execution. Wake signals are
best effort; scans and stable state provide recovery. There is no second generic Outbox.

Lumen updates or removes an entry only when its filesystem type, managed target, SQLite Revision
and recorded observation prove ownership. Existing non-Lumen content wins: Lumen leaves it
untouched, records the managed Revision as Shadowed and lets the AgentRun continue in a visible
degraded state.

For Git roots, Lumen lists only its concrete entries in a marked repository-local
`info/exclude` block. It does not modify `.gitignore` and does not ignore whole Runtime
configuration directories.

<a id="adr-0017-runtime-and-context-semantics"></a>
#### Runtime and context semantics

Native discovery remains the only mechanism by which a Runtime loads Skill content. Lumen adds
one stable reminder to a new Native Session Charter but does not inject Skill bodies or a dynamic
Skill list into every AgentRun prompt. An Adapter without verified native discovery reports an
unsupported capability.

Each immutable ContextManifest records the exact Lumen Revision exposure observed at AgentRun
start, including non-ready results. This is an observability fact, not proof that the Runtime or
model read the Skill.

Projection does not switch during an AgentRun that can still read the execution root. Skill
changes do not automatically invalidate Native Sessions and do not enter the Native Binding
compatibility digest. Across later Turns, a Runtime may use cached content or rediscover the
current project entry according to its native behavior; Lumen does not claim cross-Turn Skill
freezing. Users can explicitly restart a Native Session when they require deterministic pickup of
the latest projection.

<a id="adr-0017-permission-boundary"></a>
#### Permission boundary

Import, enablement and projection do not grant authority. Skill scripts and tool usage remain
subject to the member's Runtime-native permission configuration and Lumen's existing
Approval/Action boundaries. Bundled Skills receive no bypass.

<a id="adr-0017-consequences"></a>
### Consequences

- Lumen owns one inspectable, durable source for Skill content without affecting Agent sessions
  outside Lumen.
- Immutable Revisions prevent an update from rewriting files already referenced by an active Run.
- Runtime-specific discovery evolves behind `AgentRuntimeAdapter` while the Skill domain remains
  Provider-neutral.
- Project Skill conflicts are safe and visible rather than destructive.
- Persistent projection and startup reconciliation work with local SQLite recovery, but Lumen must
  implement careful filesystem ownership checks and local Git exclude maintenance.
- The same execution root cannot provide different Revision views to concurrent Sessions.
  Therefore v0.08 guarantees stability only within an active AgentRun, not across all Turns of a
  Native Session.
- Skill enablement is intentionally independent from execution trust; users may still receive
  Runtime or Lumen approvals when a Skill performs work.
- Future Agent/project-specific activation requires a separate assignment relation, not an
  overloaded scope enum.

<a id="adr-0017-rejected-alternatives"></a>
### Rejected Alternatives

- Installing Lumen Skills into Runtime user-level directories: rejected because it leaks Lumen
  configuration into unrelated Agent use.
- Keeping links to import source directories: rejected because sources are mutable and may
  disappear.
- Copying a separate mutable Skill tree per Adapter: rejected because contents can diverge and
  updates become non-auditable.
- Injecting `SKILL.md` bodies into prompts: rejected because it bypasses native progressive
  discovery and creates context duplication.
- Per-AgentRun mount/unmount in a shared execution root: rejected because concurrent Runs and
  long-lived Native Sessions would race.
- Overwriting a project-owned same-name Skill: rejected because Lumen cannot claim ownership of
  user content.
- Automatically rebuilding every Native Session after Skill changes: rejected in favor of
  Session continuity and explicit restart.
- Treating enablement or Bundled origin as permission approval: rejected because content
  availability and side-effect authority are separate security decisions.

<a id="adr-0017-references"></a>
### References

- [v0.08 Skill Library 与 Runtime 原生发现](README.md)
- [v0.08 架构与协议](architecture.md)
- [ADR-0001: Core Transaction](../v0.02/decisions.md#adr-0001)
- [ADR-0009: Reproducible Context Materialization and Delivery](../v0.05/decisions.md#adr-0009)
- [ADR-0013: Managed Content and Read Side v2](../v0.06/decisions.md#adr-0013)
- [ADR-0016: Multi-Runtime Execution Boundary v2](../v0.06/decisions.md#adr-0016)
<!-- legacy-adr-body:end id=ADR-0017 -->
<!-- legacy-adr:end id=ADR-0017 -->
