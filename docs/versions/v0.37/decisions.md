---
document_type: version-decisions
version: v0.37
lifecycle: historical
last_updated: 2026-08-18
---

# v0.37 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0103](#adr-0103) | Canonical MCP JSON and Stable Assignment Identity | `accepted` |
| [ADR-0104](#adr-0104) | Rovai-Preferred MCP Projection and Non-Blocking External Degradation | `superseded` |
| [ADR-0105](#adr-0105) | Runtime-Group Assigned Rovai Skill Delivery | `accepted` |

<!-- legacy-adr:begin id=ADR-0103 source-file-sha256=1fba69aba56614b5141874d7018f5a364d4fa7f15b7bcc51065abd0e68439887 -->
<a id="adr-0103"></a>

## ADR-0103: Canonical MCP JSON and Stable Assignment Identity

迁移时原路径：`docs/adr/0103-canonical-mcp-json-and-stable-assignment-identity.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0103
title: Canonical MCP JSON and Stable Assignment Identity
status: accepted
date: 2026-08-04
decision_scope: cross-version
source_version: v0.37
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0103 -->
<a id="adr-0103-context"></a>
### Context

ADR-0018 established one file-backed MCP Library, but its first implementation exposed a
Rovai-specific tagged Server schema and embedded `enabled` plus `agentProfileIds` into every
connection definition. That representation makes ordinary MCP JSON harder to paste or review,
couples mutable display names to authority, and forces the settings UI to understand separate
Command, Args, URL and Headers forms.

Server names are user-editable object keys. They cannot safely identify Assignments: renaming a
Server must not retarget authority, while deleting and recreating the same name must not inherit old
Assignments. Definitions, enablement and Assignments still need one atomic, inspectable source
without a second SQLite truth.

<a id="adr-0103-decision"></a>
### Decision

<a id="adr-0103-one-canonical-json-envelope"></a>
#### One canonical JSON envelope

`~/.rovai/mcp.json` is the only source of truth for user-managed external MCP Server definitions,
enablement, immutable identity and Assignments. SQLite contains no MCP Server or Assignment truth.
Production code does not select a legacy brand path.

The public connection surface is the standard top-level `mcpServers` object. Each key is the
canonical MCP Server Name and each value is one strict portable connection definition:

- Stdio requires `command` and may contain `args`, `env` and `cwd`;
- HTTP requires `url` and may contain `headers`;
- `command` and `url` are mutually exclusive and determine transport;
- user definitions cannot contain `serverName`, `transport`, `type`, `enabled`,
  `agentProfileIds`, `missingValues`, `_rovai` or unknown fields.

Rovai-owned state lives in one sibling top-level `_rovai` object with schema version `2`.
`_rovai.servers` is keyed by the same canonical Server Name and records an immutable opaque
`serverId`, `enabled`, provenance and reviewed risk metadata. `_rovai.assignments` contains
relationships from `serverId` to `agentProfileId`. It never uses a mutable Server Name as a foreign
key and never duplicates the name in a `serverName` field.

The same file is validated, normalized and replaced atomically as one unit. Duplicate JSON object
keys, case-insensitive duplicate Server Names, duplicate Server IDs, definition/metadata parity
errors or malformed Assignments invalidate the whole file. Invalid bytes are preserved and are
never replaced by an empty repair.

<a id="adr-0103-hidden-management-metadata"></a>
#### Hidden management metadata

The ordinary add/edit surface accepts exactly one standard `mcpServers` entry and never renders or
accepts `_rovai`. The editable object key is the Server Name; rename moves that key while retaining
the existing `serverId`, enablement, Assignments and provenance. No split connection form is
maintained in parallel.

The settings page may show a read-only public configuration preview, but it contains only
`mcpServers`, masks literal sensitive values and is explicitly not the complete source file. The
actual source path may be opened in an external editor.

Raw external editing is an advanced path and must provide a complete valid envelope. Rovai does not
infer identity, repair parity or silently discard malformed fields from raw edits. Read-only loading
preserves Assignments whose AgentProfile is currently unknown as inert data and does not surface an
MCP-page warning. A later successful application-managed mutation prunes those dangling
Assignments.

<a id="adr-0103-identity-and-lifecycle"></a>
#### Identity and lifecycle

Creating a Server generates a new `serverId` and defaults to disabled and unassigned. Import uses
the same rule. Replacing an existing Server through an explicitly chosen import target preserves
its identity, enablement and Assignments. Editing the connection, transport, secret references or
Server Name also preserves identity.

Deleting a Server atomically removes its definition, metadata and Assignments. Recreating the same
name creates a new identity and never revives old Assignments.

An Assignment and enablement are independent persisted facts. A disabled Server may remain
assigned; it becomes eligible for a future AgentRun only when both facts are true.

<a id="adr-0103-reviewed-built-in-definitions"></a>
#### Reviewed built-in definitions

When `~/.rovai/mcp.json` does not exist, Core atomically creates it with reviewed Context7 and
Playwright definitions. Both begin disabled and unassigned. Context7 uses its reviewed remote
endpoint; Playwright uses an exact reviewed package version with isolated browser state and
persistent high-permission risk provenance. GitHub is not a reviewed default.

After creation these are ordinary definitions: users may edit, rename or delete them and they use
the same Assignment and Runtime Projection path as every other Server. Deletion is not automatically
reversed and application upgrades never overwrite an existing instance. Only creation of a new
canonical file materializes the current reviewed defaults.

The first transition that makes a high-permission instance both enabled and assigned requires an
explicit UI acknowledgement recorded in its hidden metadata. This is a product safeguard, not a
Core tool authorization policy or replacement for Runtime-native approval.

<a id="adr-0103-sensitive-values-and-compatibility"></a>
#### Sensitive values and compatibility

The Renderer receives literal values in `env` and `headers` only through non-persistable,
digest-bound preservation markers. An unchanged marker preserves the exact stored value; replacing
or deleting it changes the canonical file atomically. Markers never enter `mcp.json`, an AgentRun
projection or logs. Environment references remain visible.

There is no production compatibility reader or automatic v1 migration because the application has
not shipped this schema. A developer may migrate, back up or delete local test data outside
production logic.

<a id="adr-0103-consequences"></a>
### Consequences

- Users work with one familiar `mcpServers` JSON shape while Rovai keeps stable authority metadata
  in the same atomic file.
- Rename and delete/recreate behavior can no longer accidentally retarget Assignments.
- Core must enforce duplicate-key detection, parity, case-folded uniqueness, redaction and
  marker-bound secret preservation before every write.
- A fresh configuration is immediately useful for Assignment without silently activating any
  third-party connection.
- Importers normalize into one model and cannot persist temporary missing-value markers or Runtime
  policy fields.
- Raw file editing is powerful but intentionally fail-closed; the UI does not attempt identity
  recovery from ambiguous bytes.

<a id="adr-0103-rejected-alternatives"></a>
### Rejected Alternatives

- Store Assignments in SQLite: rejected because it creates a second truth and prevents one atomic
  file compare-and-set.
- Use the Server Name as the Assignment key: rejected because the name is mutable and reusable.
- Expose `_rovai` in the JSON editor: rejected because management metadata is not a connection
  definition and would invite accidental identity changes.
- Keep split Command/Args/URL/Headers forms beside JSON: rejected because two editors inevitably
  diverge and obscure the canonical payload.
- Restore built-ins after deletion or overwrite them on upgrade: rejected because a reviewed
  starting point does not justify taking ownership of the user's later configuration.
- Persist import placeholders such as `missingValues`: rejected because transient secret recovery
  state is not a Server Definition.
- Ship a generic legacy migration: rejected because there is no released population to justify a
  permanent compatibility path.

<a id="adr-0103-references"></a>
### References

- [v0.37 MCP Configuration and Projection](README.md)
- [ADR-0018: File-Backed MCP Library and Per-Run Runtime Projection](../v0.09/decisions.md#adr-0018)
- [ADR-0057: Member Presence and Retained Removal](../v0.15/decisions.md#adr-0057)
<!-- legacy-adr-body:end id=ADR-0103 -->
<!-- legacy-adr:end id=ADR-0103 -->

<!-- legacy-adr:begin id=ADR-0104 source-file-sha256=aac5918435879585ac9ab9b4349bd9d2d495895244f18f938d7058f4e10b7a4e -->
<a id="adr-0104"></a>

## ADR-0104: Rovai-Preferred MCP Projection and Non-Blocking External Degradation

迁移时原路径：`docs/adr/0104-rovai-preferred-mcp-projection-and-external-degradation.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0104
title: Rovai-Preferred MCP Projection and Non-Blocking External Degradation
status: superseded
date: 2026-08-04
decision_scope: cross-version
source_version: v0.37
supersedes: []
superseded_by: ADR-0125
```

<!-- legacy-adr-body:begin id=ADR-0104 -->
> 本决策已由 [ADR-0125](../v0.43/decisions.md#adr-0125) 替代。

> 后续 Codex 专项规范：[ADR-0107](../v0.39/decisions.md#adr-0107)
> 以 Camp/AgentProfile 隔离 `CODEX_HOME` 和逐 AgentRun app-server 替代 Codex whole-table
> override 的 ambient 隔离假设；本文的同名 Rovai 优先、frozen input 和单次外部降级语义
> 继续有效。

<a id="adr-0104-context"></a>
### Context

Rovai projects a frozen external MCP set into several Runtime CLIs while those Runtimes may also
discover user, project, plugin or built-in MCP Servers. A same-named native Server must not silently
win over the Server the user enabled and assigned in Rovai. Rejecting the AgentRun solely because
of that collision is also unnecessary when an Adapter can disable, override or privately alias the
native entry.

Earlier policy also treated unsupported external projection as an AgentRun admission failure.
External MCP is an optional capability rather than the base execution engine: invalid connection
data, a missing environment value or a Runtime flag regression should be visible and frozen, but
must not prevent the member's new AgentRun from starting without external MCP. Internal Team
Gateway attachment remains a separate capability and must not be disabled merely because external
projection degrades.

<a id="adr-0104-decision"></a>
### Decision

<a id="adr-0104-canonical-precedence-across-every-adapter"></a>
#### Canonical precedence across every Adapter

For Codex, Claude Code, OpenCode, Copilot, Kiro, Qoder, CodeBuddy and Qwen Code, a Server requested
by the AgentRun's Rovai projection has precedence over every Runtime-native Server with the same
case-insensitive canonical name. The Adapter must use a Runtime-native mechanism such as strict
private configuration, complete override, explicit native disablement or a temporary private alias
to ensure the Rovai definition is the one actually available.

If an alias is required, it is Adapter-private and frozen with a canonical-name to Runtime-name
mapping. It is never written to `mcp.json`, never changes Server identity and is shown only in
diagnostics, recovery evidence or model instructions required to use the projected name.

An Adapter never mutates a Runtime's user or project configuration. Read-only discovery may inform
collision handling, but every override is carried by process arguments, a private configuration
environment or Rovai-owned `0600` temporary files. Non-conflicting native MCP treatment continues
to follow that Adapter's declared ambient-isolation policy.

The same precedence applies to the reserved internal `rovai_team` name, while External MCP
Projection and Team Gateway Attachment remain independent capability axes.

<a id="adr-0104-unsupported-means-explicit-external-degradation"></a>
#### Unsupported means explicit external degradation

When an Adapter cannot reliably prove Rovai precedence and its declared isolation semantics, its
external MCP capability is unsupported. It must not report success, use a same-named native Server
or fail an AgentRun merely because a requested external Server is unavailable.

AgentRun creation freezes one MCP Projection Input containing definitions, enablement, Assignments,
resolved environment values and canonical configuration digest. The Runtime startup derives only
from this frozen input:

- a definition-local environment, cwd or transport failure excludes that Server only;
- an invalid whole canonical file or unsupported exact projection produces an empty external
  projection;
- every omission records a typed degradation reason and is never described to the model as an
  available tool;
- Team Gateway preparation proceeds independently under its own capability and safety protocol.

If a Runtime at or above the Adapter's necessary minimum version explicitly rejects the normal
external MCP configuration or flags during startup, the Adapter may record the rejection and retry
exactly once without user external MCP. The retry uses the same frozen Projection Input and does not
reread `mcp.json`. Non-MCP startup failures do not use this fallback.

After a Runtime Session starts successfully, Core seals the final MCP Exposure Snapshot containing
requested Servers, projected Servers, canonical/runtime name mapping and every degradation reason.
Recovery reuses that final private projection; only a later AgentRun evaluates newer canonical
state.

<a id="adr-0104-compatibility-and-evidence"></a>
#### Compatibility and evidence

Adapters declare only the first Runtime version known to support their required official mechanism.
There is no acceptance upper bound: newer versions continue attempting the same path and degrade
only on observed rejection. User machines are not subjected to synthetic test Sessions or live MCP
probes from the settings page.

Development acceptance uses real Runtime CLIs and real MCP protocol Servers. Same-name smoke tests
must distinguish a native marker from a Rovai marker and call the projected tool. Context7 and
Playwright default smokes use their real connection paths; missing optional external credentials
produce an explicit unverified result rather than a mock success.

<a id="adr-0104-consequences"></a>
### Consequences

- Same-name collisions have one predictable semantic across all supported Runtime Adapters.
- Members can still work when optional external MCP configuration is invalid or temporarily
  unsupported, with precise frozen diagnostics instead of a misleading fallback.
- Adapters need richer private projection evidence, canonical/runtime name maps and a bounded
  MCP-specific startup fallback.
- Runtime upgrades do not require arbitrary maximum-version churn, but incompatible changes become
  observable degraded Runs until the Adapter is updated.
- Settings status can describe readiness and last frozen projection without contacting third-party
  Servers or claiming online state.

<a id="adr-0104-rejected-alternatives"></a>
### Rejected Alternatives

- Let the Runtime choose between same-named entries: rejected because the user could silently
  receive a different tool authority than the Rovai Assignment.
- Fail every collided or unsupported AgentRun: rejected because external MCP is optional and the
  base Runtime can continue honestly without it.
- Fall back to the native same-named Server: rejected because matching names do not prove matching
  configuration, credentials, permissions or tool behavior.
- Mutate the user's Runtime configuration: rejected because it crosses ownership boundaries and
  makes cleanup, concurrent launches and crash recovery unsafe.
- Add maximum accepted Runtime versions: rejected because an untested newer version is not itself
  evidence of incompatibility.
- Probe or smoke MCP Servers on user machines: rejected because the settings page is not an
  execution or trust boundary and should not create external side effects.

<a id="adr-0104-references"></a>
### References

- [v0.37 MCP Configuration and Projection](README.md)
- [ADR-0018: File-Backed MCP Library and Per-Run Runtime Projection](../v0.09/decisions.md#adr-0018)
- [ADR-0065: Verified Runtime Catalog](../v0.19/decisions.md#adr-0065)
- [ADR-0088: Attested Native Team Gateway Attachment](../v0.30/decisions.md#adr-0088)
<!-- legacy-adr-body:end id=ADR-0104 -->
<!-- legacy-adr:end id=ADR-0104 -->

<!-- legacy-adr:begin id=ADR-0105 source-file-sha256=41786ad692f8d2046edf64444fd290e8b92404b78948333f9fa0847cd20d4f06 -->
<a id="adr-0105"></a>

## ADR-0105: Runtime-Group Assigned Rovai Skill Delivery

迁移时原路径：`docs/adr/0105-runtime-group-assigned-skill-delivery.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0105
title: "Runtime-Group Assigned Rovai Skill Delivery"
status: accepted
date: 2026-08-04
decision_scope: cross-version
source_version: v0.37
supersedes: [ADR-0017]
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0105 -->
> 后续局部规范：[ADR-0144](../v0.49/decisions.md#adr-0144) 规定当前四个
> 官方 Skill、自包含依赖与仓库顶层 `skills/` 源码目录；本文的 `rovai-` 前缀、默认启用且
> 未分配以及其余投递语义继续有效。

<a id="adr-0105-context"></a>
### Context

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

<a id="adr-0105-decision"></a>
### Decision

<a id="adr-0105-library-identity-and-revisions"></a>
#### Library identity and revisions

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

<a id="adr-0105-enablement-and-assignment"></a>
#### Enablement and assignment

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

<a id="adr-0105-safe-projection-and-overlapping-discovery"></a>
#### Safe projection and overlapping discovery

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

<a id="adr-0105-run-stability-and-presentation"></a>
#### Run stability and presentation

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

<a id="adr-0105-consequences"></a>
### Consequences

- Users can pause delivery without losing a carefully selected Group set.
- Library identity and import-update behavior remain simple and globally unique.
- Rovai no longer depends on or takes ownership of the shared `.agents/skills` convention.
- Overlapping Runtime discovery is explicit in saved intent but avoids redundant filesystem links.
- Runtime-native duplicates remain safe and honest but intentionally unresolved.
- One execution root still cannot provide different Revision views to concurrent Runs that discover
  the same Group; active-Run stability therefore defers changes instead of promising Member isolation.
- Documentation-only Groups require ongoing Adapter-level verification and may not work until that
  evidence exists.

<a id="adr-0105-rejected-alternatives"></a>
### Rejected Alternatives

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

<a id="adr-0105-references"></a>
### References

- [ADR-0150: Evidence-First Agent Codebase Analysis Bundled Skill](../v0.52/decisions.md#adr-0150)
- [ADR-0017: Managed Skill Library and Runtime-Native Projection](../v0.08/decisions.md#adr-0017)
- [Settings workspace UI strategy](../../../apps/desktop/.impeccable/surfaces/settings-workspace.md)
- [Domain terminology](../../../CONTEXT.md)
<!-- legacy-adr-body:end id=ADR-0105 -->
<!-- legacy-adr:end id=ADR-0105 -->
