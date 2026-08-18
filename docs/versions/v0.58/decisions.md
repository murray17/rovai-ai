---
document_type: version-decisions
version: v0.58
lifecycle: historical
last_updated: 2026-08-18
---

# v0.58 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0156](#adr-0156) | Frozen Logical Runtime Identity and Bounded Installation Rebind | `accepted` |
| [ADR-0157](#adr-0157) | Message-Owned AgentRun Instruction Without Expected Output Metadata | `accepted` |
| [ADR-0158](#adr-0158) | Default-All Runtime Delivery for Managed Skills | `accepted` |
| [ADR-0159](#adr-0159) | Pinned Third-Party Tasteful UI Bundled Skill | `superseded` |
| [ADR-0160](#adr-0160) | Focused Camp Inspector and Single Approval Surface | `accepted` |
| [ADR-0161](#adr-0161) | Event-Driven Root-Scoped Skill Projection Reconciliation | `accepted` |

<!-- legacy-adr:begin id=ADR-0156 source-file-sha256=5101bfd7288d4c21d830b897dae653747a35ee9910e9e582c087d576f283cac2 -->
<a id="adr-0156"></a>

## ADR-0156: Frozen Logical Runtime Identity and Bounded Installation Rebind

迁移时原路径：`docs/adr/0156-logical-runtime-identity-and-bounded-installation-rebind.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0156
title: Frozen Logical Runtime Identity and Bounded Installation Rebind
status: accepted
date: 2026-08-11
decision_scope: cross-version
source_version: v0.58
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0156 -->
<a id="adr-0156-context"></a>
### Context

ADR-0075 freezes an AgentRun executable path and fingerprint, then rejects launch when the executable
content no longer matches. This detects real replacement, but it also turns a normal in-place CLI update
between Run creation and dispatch into a terminal `runtime_integrity_failed`. Product Runtime installations
are mutable discovery and probe state; a queued Run should not require the installation bytes to remain
unchanged forever when Core can re-establish the same trusted and compatible logical Runtime binding.

Removing integrity verification entirely would lose the launch-time safety boundary. Silently overwriting the
Run snapshot would instead lose reproducibility and make repeated drift unbounded. Core needs a recovery path
that preserves the requested Runtime semantics and the initial executable evidence while allowing one verified
effective installation refresh.

<a id="adr-0156-decision"></a>
### Decision

An AgentRun freezes its logical Runtime identity: Adapter kind, Installation ID, authentication scope, model
selection semantics and permission configuration. An explicit model remains explicit with the same model ID
and options; `runtime_default` remains a request for the refreshed Runtime default. These values cannot be
changed by drift recovery.

The initial reported version and executable fingerprint are immutable audit evidence. The effective path,
reported version, fingerprint, installation/search generation, capability snapshot, compatible protocol,
session compatibility key and derived config digests may change only through the Core-owned pre-dispatch
Runtime rebind command.

When dispatch detects a changed fingerprint, unavailable path, stale snapshot or a snapshot changed by an
earlier refresh, Core must:

1. mark the old capability snapshot stale when the execution-boundary check observed the drift;
2. invalidate resident processes for the Adapter;
3. bypass refresh deferral and synchronously re-discover/deep-probe a managed Installation, or deep-probe the
   same explicit path for a custom Installation;
4. resolve a new effective Runtime from the Run's frozen logical identity;
5. atomically rebind the queued/recovery-waiting Run, write `agent_run.runtime_drift_detected` and
   `agent_run.runtime_rebound`, then repeat blocker and executable-integrity validation;
6. continue the same Run when the repeated validation succeeds.

Automatic rebind is limited to once per AgentRun and is persisted in `runtime_rebind_count`. A second drift
during or after that recovery is terminal. The rebind must also fail closed when the Installation is missing or
disabled, Adapter/Installation/authentication/policy identity changes, an explicit model is unavailable,
authentication or capability probing is not ready, no supported protocol can be resolved, the refreshed config
digest is invalid, or the executable changes again during the bounded refresh.

`runtime_integrity_failed` is reserved for identity/trust/integrity that cannot be re-established. Probe,
authentication, compatibility and refresh failures retain their more specific blocker/error codes. This
decision locally replaces ADR-0075's requirement that an existing AgentRun path and fingerprint remain
immutable; ADR-0075's message-first boundary, metadata fast path, conditional SHA-256 and initial evidence
requirements remain in force.

<a id="adr-0156-consequences"></a>
### Consequences

Normal in-place CLI updates no longer terminally fail an otherwise compatible queued Run. The same public
message, CampTurn and AgentRun continue after one synchronous refresh, while the initial and effective
executable evidence remain distinguishable and the full transition is append-only auditable.

Dispatch after detected drift is slower because it performs discovery, version inspection, deep probing and a
second integrity check. The one-rebind limit favors bounded behavior over indefinite availability. Runtime
implementations without stronger package-signing provenance continue to rely on the Installation source/path,
successful deep probe and existing local trust model; this decision does not claim artifact signature
verification that the product does not perform.

<a id="adr-0156-rejected-alternatives"></a>
### Rejected Alternatives

- Failing every fingerprint mismatch was rejected because benign in-place Runtime upgrades are recoverable
  installation drift, not necessarily a trust violation.
- Removing fingerprint checks was rejected because Core would no longer detect replacement at the actual
  execution boundary.
- Updating only the capability snapshot was rejected because the Run's JSON and redundant Runtime columns
  would disagree and dispatch would remain blocked.
- Rebinding from the Member's current live configuration was rejected because it could silently change the
  Run's model or permission intent.
- Unlimited refresh/retry was rejected because a repeatedly changing executable could keep a Run nonterminal
  and repeatedly execute probe candidates.

<a id="adr-0156-references"></a>
### References

- [v0.58 overview](README.md)
- [ADR-0066: Managed Product Runtime Resolution](../v0.20/decisions.md#adr-0066)
- [ADR-0075: Runtime Integrity at Change and Execution Boundaries](../v0.24/decisions.md#adr-0075)
- [ADR-0127: Atomic Member Runtime Configuration](../v0.43/decisions.md#adr-0127)
- [Built-in Tool Runtime architecture](../../architecture/builtin-tool-runtime.md)
<!-- legacy-adr-body:end id=ADR-0156 -->
<!-- legacy-adr:end id=ADR-0156 -->

<!-- legacy-adr:begin id=ADR-0157 source-file-sha256=844c786dbdd64576da0e282a4413502e5b4e7b55f9d0625b537ca8016183c79b -->
<a id="adr-0157"></a>

## ADR-0157: Message-Owned AgentRun Instruction Without Expected Output Metadata

迁移时原路径：`docs/adr/0157-message-owned-agentrun-instruction-without-expected-output.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0157
title: Message-Owned AgentRun Instruction Without Expected Output Metadata
status: accepted
date: 2026-08-11
decision_scope: cross-version
source_version: v0.58
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0157 -->
<a id="adr-0157-context"></a>
### Context

Every AgentRun currently persists a required free-text `expectedOutput`, but Core does not materialize that
field into `CURRENT_INPUT`, Session Bootstrap or another Runtime input. It does not participate in admission,
scheduling, completion, public-output publication or quality verification. Direct user execution and Message
Delivery therefore fill the field with generic producer-owned text that is neither an authoritative user
instruction nor an enforced acceptance criterion.

The immutable trigger CampMessage or ConversationMessage already owns the per-Run natural-language request.
Task admission facts establish responsibility identity without duplicating mutable Task content, while Runtime,
public-output and cancellation contracts define execution behavior. Retaining a mandatory but behaviorally inert
output field creates a false contract surface and invites callers to assume enforcement that does not exist.

<a id="adr-0157-decision"></a>
### Decision

The trigger Message body delivered as `CURRENT_INPUT` is the sole per-AgentRun natural-language work instruction.
`purpose` remains a compact Core audit and responsibility descriptor; it is not a second model-input instruction.
Stable execution, Runtime, Task and public-output contracts continue to provide their own non-natural-language
behavioral constraints.

Core removes `expectedOutput` from execution request IPC, AgentRun domain and read models, SQLite persistence and
producer-specific defaults. No optional replacement, derived value or compatibility alias is introduced. The
schema migration drops only the obsolete column and preserves existing AgentRun identity, lifecycle, lineage,
Task admission, Runtime snapshot and evidence.

Core does not infer successful work from Runtime final text or compare an outcome with free-text output metadata.
AgentRun lifecycle remains observation-based, and public Camp output remains governed by the explicit Runtime
public-output boundary and successful `rovai send` operations.

This decision locally replaces ADR-0137 clauses that assign work-instruction ownership to a combination of
message, purpose and expected-output contracts. ADR-0137's one-time Task-linked admission, frozen admission facts,
grandfathering and explicit cancellation boundaries remain unchanged.

<a id="adr-0157-consequences"></a>
### Consequences

Execution requests and AgentRun read models become smaller and no longer claim an unenforced acceptance contract.
Every caller relies on the same trigger Message bytes that Context already freezes and delivers. Historical
`expected_output` text is discarded during migration because no runtime, recovery or audit decision consumes it.

Removing a previously required IPC and read-model field is a deliberate clean break. Callers compiled against the
old shape must stop sending or reading it. Product behavior does not lose a Runtime instruction because the field
was never delivered to Runtime.

<a id="adr-0157-rejected-alternatives"></a>
### Rejected Alternatives

- Injecting `expectedOutput` into every Runtime request was rejected because generic producer text would duplicate
  or conflict with the authoritative trigger Message and create a second natural-language instruction plane.
- Keeping an optional deprecated field was rejected because it would preserve ambiguous ownership and indefinite
  compatibility work without any behavioral consumer.
- Deriving expected output from Task Acceptance Criteria was rejected because ordinary Runs need not be Task-linked
  and accepted Task responsibility must not become a continuously re-evaluated execution fence.
- Removing `purpose` in the same decision was rejected because it still provides a compact responsibility and audit
  descriptor independently of model input.

<a id="adr-0157-references"></a>
### References

- [v0.58 overview](README.md)
- [ADR-0134: Explicit Runtime Public Output Boundary](../v0.45/decisions.md#adr-0134)
- [ADR-0137: One-Time Task-Linked Responsibility Admission](../v0.47/decisions.md#adr-0137)
- [ADR-0147: Lossless Model Context Projection](../v0.50/decisions.md#adr-0147)
- [Durable Task v3](../../contracts/durable-task-v3.md)
- [Message Delivery v1](../../contracts/message-delivery-v1.md)
<!-- legacy-adr-body:end id=ADR-0157 -->
<!-- legacy-adr:end id=ADR-0157 -->

<!-- legacy-adr:begin id=ADR-0158 source-file-sha256=39beb87349ae8decaa37fa5f8a9997b0a005450616f49dffc56e944d31a39410 -->
<a id="adr-0158"></a>

## ADR-0158: Default-All Runtime Delivery for Managed Skills

迁移时原路径：`docs/adr/0158-default-all-runtime-delivery-for-managed-skills.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0158
title: Default-All Runtime Delivery for Managed Skills
status: accepted
date: 2026-08-11
decision_scope: cross-version
source_version: v0.58
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0158 -->
<a id="adr-0158-context"></a>
### Context

Rovai installs official and user-imported Skills enabled but historically creates no Skill Group Assignment. A user can
explicitly request an installed workflow by name while the selected Agent Runtime cannot discover its managed Revision,
because Library availability alone does not create a project-native projection. This causes the Runtime to search only
independently owned native Skill locations even though the Settings library presents the Skill as installed and active.

Skill Group Assignment remains the correct delivery authority: Runtime-native discovery paths differ, overlapping
Groups require explicit saved intent, and ContextManifest must freeze actual exposure rather than claim prompt-level
injection. The default policy therefore needs to change without replacing native projection with a second prompt
protocol or removing the user's ability to pause and customize delivery.

<a id="adr-0158-decision"></a>
### Decision

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

<a id="adr-0158-consequences"></a>
### Consequences

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

<a id="adr-0158-rejected-alternatives"></a>
### Rejected Alternatives

- Keep new Skills unassigned: rejected because installed workflows remain unavailable until users discover a separate
  delivery setting, even when they invoke the Skill explicitly.
- Reapply all Assignments at every startup: rejected because a default must not erase later user choices.
- Apply the default only to official Skills: rejected because installed-and-enabled behavior should be consistent for
  imported Skills and native conflict handling already fails safely without overwriting existing entries.
- Inject Skill bodies into every AgentRun prompt: rejected because it bypasses native progressive discovery,
  duplicates the Skill protocol, consumes context unconditionally, and weakens exposure evidence.

<a id="adr-0158-references"></a>
### References

- [v0.58 overview](README.md)
- [ADR-0105: Runtime-Group Assigned Rovai Skill Delivery](../v0.37/decisions.md#adr-0105)
- [ADR-0150: Evidence-First Agent Codebase Analysis Bundled Skill](../v0.52/decisions.md#adr-0150)
- [Skill settings UI strategy](../../../apps/desktop/.impeccable/surfaces/settings-workspace.md)
- [Domain terminology](../../../CONTEXT.md)
<!-- legacy-adr-body:end id=ADR-0158 -->
<!-- legacy-adr:end id=ADR-0158 -->

<!-- legacy-adr:begin id=ADR-0159 source-file-sha256=56d1363c60b4897d061ae3cb270588ed47f181e527fc628b7a8ac011c5ea4571 -->
<a id="adr-0159"></a>

## ADR-0159: Pinned Third-Party Tasteful UI Bundled Skill

迁移时原路径：`docs/adr/0159-pinned-third-party-tasteful-ui-bundled-skill.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0159
title: Pinned Third-Party Tasteful UI Bundled Skill
status: superseded
date: 2026-08-11
decision_scope: cross-version
source_version: v0.58
supersedes:
  - ADR-0150
superseded_by: ADR-0167
```

<!-- legacy-adr-body:begin id=ADR-0159 -->
<a id="adr-0159-context"></a>
### Context

Rovai's five official Skills cover memory stewardship, Task-scoped worktrees, self-contained duo clarification, and
evidence-first Agent repository analysis. Meaningful Renderer and web UI work also repeatedly needs a disciplined way
to understand product context, explore taste before selecting references, turn a chosen direction into executable
design rules, and verify whether the result is actually better rather than merely more stylized.

The upstream `tasteful-ui` Skill already packages that workflow and its reference catalog under an MIT license. Leaving
it as an optional user import makes the workflow dependent on external discovery and mutable branch state. Copying only
its router would also produce broken progressive-disclosure links and remove the concrete design references that make
the Skill useful. Rovai therefore needs an auditable, immutable third-party source boundary rather than a floating
network dependency or a partial transcription.

<a id="adr-0159-decision"></a>
### Decision

Rovai ships exactly six official Skills:

- `analyze-agent-codebase` (“Agent 代码库分析”);
- `memory-stewardship` (“共同记忆维护”);
- `worktree` (“隔离 Worktree”);
- `grill-duo` (“双人追问”);
- `grill-duo-with-docs` (“双人追问与文档”);
- `tasteful-ui` (“品味优先 UI 设计”).

Official identity remains the unprefixed Skill name plus `origin = official` and immutable bundled source. The first
five Skills retain ADR-0150's self-contained behavior: codebase analysis is evidence-first and read-only by default;
the duo Skills carry their own asynchronous public A2A protocol and required references; no Skill grants filesystem,
Git, documentation, collaboration, Tool, approval, permission, or implementation authority. ADR-0158 continues to own
the independent default-on and all-Runtime-group assignment policy and preservation of later user changes.

`tasteful-ui` is vendored from `https://github.com/DonkeyKing01/tasteful-ui-skill` at the exact Git revision
`159ccd47a320f3a7bd0289d07366d422211895a1`. The repository source under `skills/tasteful-ui/` contains all 81 upstream
Skill files, the upstream MIT license, a pinned-source notice, and Rovai-owned `agents/openai.yaml` presentation
metadata. Core's build step recursively enumerates that complete directory, rejects symbolic links and unsupported
nodes, embeds every regular UTF-8 file, and publishes the resulting 84-file snapshot through the existing immutable
SkillRevision installation path. The repository source is packaging input, never a Runtime discovery root.

The bundled Skill keeps its upstream router, investment gates, taste exploration, project-design format, reference
catalog, implementation workflow, and verification rubric intact. Those instructions guide an Agent after the Skill is
selected; they do not create a new Core workflow state, force a user confirmation outside the Skill conversation,
authorize network access, or override the current user request, repository instructions, Runtime permissions, or
Rovai action-safety boundaries.

Any future upstream refresh must deliberately pin a new exact revision, re-vendor the complete Skill directory,
preserve license and source notice, validate the Skill, and publish a new immutable bundled Revision. Rovai never pulls
the upstream branch at application startup or build time. Adding or removing another official Skill must supersede this
exact inventory and update Core, terminology, UI copy, and smoke/acceptance fixtures together.

This ADR completely replaces ADR-0150 while retaining its unprefixed official identity, project-visible source,
codebase-analysis workflow, and self-contained duo decisions and extending the official inventory with the pinned
third-party Skill.

<a id="adr-0159-consequences"></a>
### Consequences

Users receive the full Tasteful UI workflow without a separate import and can assign or disable it through the same
managed Skill Library controls as every other official Skill. Reviewers can reproduce the exact upstream content,
license, file manifest, digest, and application release that produced an installed Revision. Offline application
startup remains deterministic because neither build nor install fetches the network.

The bundled binary and source repository grow by roughly 1.3 MB and 84 files. Core and UI fixtures must expect six
official Skills, and Rust compilation now regenerates one deterministic manifest when the vendored directory changes.
Upstream improvements and security fixes are not automatic; maintainers must review and pin them explicitly.

<a id="adr-0159-rejected-alternatives"></a>
### Rejected Alternatives

- Import the repository for each user: rejected because a built-in workflow should not depend on user discovery,
  mutable remote availability, or repeated confirmation.
- Track the upstream default branch at build or startup: rejected because it breaks reproducibility, offline startup,
  immutable review, and content-digest provenance.
- Bundle only `SKILL.md`: rejected because its progressive-disclosure routes would reference missing modes, workflows,
  evaluation rules, and design catalog files.
- Rewrite the Skill as Rovai-owned content: rejected because the upstream package is already suitable, MIT-licensed,
  and more auditable when retained with explicit provenance rather than silently forked.
- Treat investment gates as Core-enforced product state: rejected because they are task-local Agent workflow guidance,
  not application authority or a new persistence protocol.

<a id="adr-0159-references"></a>
### References

- [v0.58 overview](README.md)
- [ADR-0105: Runtime-Group Assigned Rovai Skill Delivery](../v0.37/decisions.md#adr-0105)
- [ADR-0150: Evidence-First Agent Codebase Analysis Bundled Skill](../v0.52/decisions.md#adr-0150)
- [ADR-0158: Default-All Runtime Delivery for Managed Skills](decisions.md#adr-0158)
- [Skill settings UI strategy](../../../apps/desktop/.impeccable/surfaces/settings-workspace.md)
- [Domain terminology](../../../CONTEXT.md)
- [`tasteful-ui` source](../../../skills/tasteful-ui/SKILL.md)
- [Pinned upstream repository](https://github.com/DonkeyKing01/tasteful-ui-skill/tree/159ccd47a320f3a7bd0289d07366d422211895a1/tasteful-ui)
<!-- legacy-adr-body:end id=ADR-0159 -->
<!-- legacy-adr:end id=ADR-0159 -->

<!-- legacy-adr:begin id=ADR-0160 source-file-sha256=6505499455f5c4616f1fc470b92a9b2b499af55d23ffd4640d31239b323a1cb4 -->
<a id="adr-0160"></a>

## ADR-0160: Focused Camp Inspector and Single Approval Surface

迁移时原路径：`docs/adr/0160-focused-camp-inspector-and-single-approval-surface.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0160
title: Focused Camp Inspector and Single Approval Surface
status: accepted
date: 2026-08-11
decision_scope: cross-version
source_version: v0.58
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0160 -->
<a id="adr-0160-context"></a>
### Context

ADR-0154 removed Activity and Audit from the Camp Inspector but retained Tasks, Context Delivery and
Approvals. In ordinary collaboration, ContextManifest is execution evidence rather than a frequent
decision surface, while the Approvals tab duplicates the same pending queue and mutation already fixed
above Composer. The remaining durable collaboration fact that users need beside Tasks is the current
Camp team and its Default Lead.

Duplicating Approval in Inspector creates two navigation targets for one blocking decision and makes a
Header pending summary unexpectedly change Inspector visibility and selection. Hiding Context Delivery
must not delete ContextManifest, weaken Runtime Input Delivery evidence or move collaboration authority
into Renderer. Moving Lead must likewise reuse the existing versioned Core command rather than create a
local selection state.

<a id="adr-0160-decision"></a>
### Decision

The ordinary Camp Inspector contains exactly two manually activated tabs:

```text
任务 | 队员
```

Tasks retain their existing list, detail, editing, responsibility, conflict and related-execution
contracts. The Team tab projects current CampMember facts only: active memberships whose profile is not
removed, in stable member order, with identity, team role, current presence, Agent Runtime readiness and
Default Lead identity. It is not a second member-management page and provides no identity, presence or
Runtime configuration mutation.

The Team tab contains the single Camp-local Default Lead control. It submits the existing
`camps.changeDefaultLead` command and never treats optimistic Renderer state as authoritative. Only an
active member with `profilePresence = present` and no pending leave request is eligible. Away, leaving,
left and removed members remain ineligible; away or leaving active members may remain visible so the
current collaboration relationship is not misrepresented.

ContextManifest, Context Delivery Profile, Runtime Input Delivery and their evidence remain unchanged in
Core, Snapshot and protocol contracts, but ordinary Inspector no longer projects a Context Delivery tab.
Removing that tab does not delete, merge or rewrite any evidence and does not authorize Renderer to infer
what a model received.

Approval Dock immediately above Composer is the only ordinary pending-Approval decision surface. It keeps
the authoritative queue order, Runtime-native choices, decision identity and existing Core mutation. Camp
Header and notification pending summaries only expand, scroll to and focus that Dock; they do not reveal,
open or change Inspector. Resolving one item focuses the next pending option, while resolving the last item
removes the Dock and returns focus to Composer. Collapsing the Dock changes presentation only and never
changes queue state.

This decision locally replaces ADR-0154's three-tab Inspector and duplicated Inspector Approvals clauses.
ADR-0154's Agent-level process grouping, Run-stage evidence, unique Stop and all Core authority boundaries
remain in force. Sidebar navigation, conversation reading, Agent execution process and Composer behavior
are outside this decision.

<a id="adr-0160-consequences"></a>
### Consequences

- The right rail distinguishes long-lived work and collaboration facts from transient blocking decisions.
- Default Lead becomes visible without exposing low-frequency ContextManifest debugging material.
- Approval has one decision surface, so Header and notification routing cannot produce divergent local
  queue state or unexpectedly alter Inspector layout.
- ContextManifest remains available to protocol, diagnostics and execution-evidence consumers even though
  it is absent from the ordinary Camp Inspector.
- Renderer and packaged-App acceptance must verify exact two-tab semantics, Lead eligibility and mutation,
  Header-to-Dock focus, Dock collapse/restore, compact width and 200% zoom.

<a id="adr-0160-rejected-alternatives"></a>
### Rejected Alternatives

- Keep Context Delivery and Approvals as disabled or hidden legacy tabs: rejected because unused routes and
  state preserve the ambiguity and can reappear without an explicit design decision.
- Move Approval into a modal: rejected because pending permission is contextual, may be concurrent, and
  must not trap or obscure Composer and the unique Stop.
- Put Lead selection in Header or Composer: rejected because it is a durable Camp collaboration fact and
  would overload the primary reading and input surfaces.
- Remove ContextManifest from Snapshot/Core: rejected because a lower-frequency UI projection does not
  change delivery evidence or audit authority.

<a id="adr-0160-references"></a>
### References

- [v0.58 overview](README.md)
- [ADR-0154: Agent-Level Continuous Execution Process Surface](../v0.55/decisions.md#adr-0154)
- [Run Process Detail Surface v3](../../contracts/run-process-detail-surface-v3.md)
- [Camp 会话工作区 UI 合同](../../ui/components/conversation-workspace.md)
<!-- legacy-adr-body:end id=ADR-0160 -->
<!-- legacy-adr:end id=ADR-0160 -->

<!-- legacy-adr:begin id=ADR-0161 source-file-sha256=67ea2ee0f569740188987a52f3451e10a6a94bcedebe3b174515530d3b9e3df8 -->
<a id="adr-0161"></a>

## ADR-0161: Event-Driven Root-Scoped Skill Projection Reconciliation

迁移时原路径：`docs/adr/0161-event-driven-root-scoped-skill-projection-reconciliation.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0161
title: Event-Driven Root-Scoped Skill Projection Reconciliation
status: accepted
date: 2026-08-11
decision_scope: cross-version
source_version: v0.58
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0161 -->
<a id="adr-0161-context"></a>
### Context

SkillProjection is a rebuildable view of the application-global Skill Library inside Runtime-native
project directories. Treating every historical observation as a permanent reconciliation target made
application startup and a fixed 30-second loop revisit old Camp directories without a current user or
AgentRun need. On macOS that behavior could repeatedly request protected-folder access even after the
Project had been removed from the sidebar.

ADR-0105 protected an active Run by retaining its old Revision projection and allowed a newer Run to
record stale exposure instead of waiting. That rule does not match the available filesystem model:
different Agents can share one execution root and Runtime discovery path, while no supported Runtime
provides a per-session Skill directory. Artificial drain, generation, or Revision leases would add a
second scheduler without delivering genuine isolation.

<a id="adr-0161-decision"></a>
### Decision

Rovai-ai keeps three separate authorities:

1. Skill Library is the application-global desired state.
2. SkillProjection is a mutable, rebuildable view in one execution root.
3. SkillExposureSnapshot is immutable evidence of what one AgentRun preflight observed at start.

Skill installation, Revision update, enablement, Group Assignment, deletion, Runtime selection, and
bundled-content repair update authoritative state and mark affected known projections dirty in SQLite.
They do not enumerate, canonicalize, watch, or reconcile historical execution roots. Application
startup restores the Library, AgentRun recovery data, projection observations, dirty/pending cleanup,
and Project-removal access state without reading those project directories. There is no periodic
filesystem reconciliation loop.

Every new AgentRun performs mandatory root-scoped preflight. Core first rejects a removed execution
root without resolving it, then canonicalizes only the current root, derives the selected Runtime's
Delivery Groups plus Groups required by other active Runs in that exact root, reconciles to the latest
Library state, verifies the resulting managed entries, and records SkillExposureSnapshot before the
Runtime starts. Missing or stale Rovai-managed entries are repaired; an unverified `error` or `stale`
entry blocks launch. Project-owned entries remain untouched and may be recorded as `shadowed` because
safe non-overwrite is stronger than forced Rovai delivery.

An active AgentRun does not lease a Revision or block another Agent's newer Run. A later preflight may
update or remove shared projection entries while the older Run continues. If the older Runtime reads
the shared directory again, it may see the newer contents or absence. SkillExposureSnapshot therefore
records start-time exposure evidence only; it is neither lifetime filesystem isolation nor proof that
the Runtime loaded a Skill. Same-Agent serialization remains an AgentRun invariant independent of
Skill projection.

Skill Projection Observation is ownership and evidence, never an access grant or scheduling source.
Stored diagnostics read SQLite facts only; a filesystem audit or broad repair requires an explicit
user action and excludes roots marked removed.

Removing a directory Project from the local sidebar mirrors `removed` Skill Projection Root Access
into Core. With no active Run, that explicit action may perform one best-effort managed-link cleanup;
with an active Run, cleanup waits only for that Run's terminal hook. Afterward Rovai-ai performs no
startup scan, periodic reconciliation, watcher creation, observation-driven access, or new Run
preflight for the removed root. Restoring or reselecting the directory marks it active and dirty so
the next Run preflight repairs it. Crash recovery may touch only roots required by genuinely active
executions.

This decision locally replaces ADR-0105's active-Run Revision retention and stale-new-Run clauses. Its
Library identity, Delivery Group, overlap, safe non-overwrite, and Runtime-native ownership rules remain
in force. ADR-0158's default-all Assignment rule also remains unchanged.

<a id="adr-0161-consequences"></a>
### Consequences

- App launch, passive diagnostics, and elapsed time no longer justify filesystem access to historical
  Project directories.
- A new Run sees the latest verified Library state without waiting for unrelated Agents to drain.
- Existing Runs continue without forced cancellation, but shared projection contents are intentionally
  not stable for their entire lifetime.
- Removed Project access is explicit and durable while Camp and AgentRun history remain intact.
- Dirty and pending cleanup state can survive restart without pretending to be live directory health.
- True Revision isolation remains unavailable until a Runtime offers a native per-session or per-Run
  Skill directory.

<a id="adr-0161-rejected-alternatives"></a>
### Rejected Alternatives

- Scan every known or observed root at startup: rejected because historical evidence is not current
  access intent and protected folders may prompt without user action.
- Reconcile every root on a fixed interval or maintain watchers: rejected because freshness is needed
  at AgentRun admission, not continuously for Settings presentation.
- Drain active Runs, queue new Runs, or maintain projection generations: rejected because shared native
  discovery paths cannot provide the isolation that this machinery would claim.
- Copy every Skill Revision into a private per-Run tree: rejected because current Runtimes do not discover
  that tree and adapter-specific emulation would create inconsistent semantics.
- Treat `SkillExposureSnapshot` as a lifetime file lock: rejected because it is durable evidence, not a
  filesystem ownership protocol.

<a id="adr-0161-references"></a>
### References

- [v0.58 overview](README.md)
- [ADR-0105: Runtime-Group Assigned Rovai Skill Delivery](../v0.37/decisions.md#adr-0105)
- [ADR-0158: Default-All Runtime Delivery for Managed Skills](decisions.md#adr-0158)
- [Skill Projection Reconciliation architecture](../../architecture/skill-projection-reconciliation.md)
- [Domain terminology](../../../CONTEXT.md)
- `crates/rovai-core/src/skill_projection.rs`
- Migration 75 in `crates/rovai-core/src/db.rs`
<!-- legacy-adr-body:end id=ADR-0161 -->
<!-- legacy-adr:end id=ADR-0161 -->
