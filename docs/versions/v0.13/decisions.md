---
document_type: version-decisions
version: v0.13
lifecycle: historical
last_updated: 2026-08-18
---

# v0.13 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0052](#adr-0052) | Explicit Memory Revision Authority | `superseded` |
| [ADR-0053](#adr-0053) | User-Preauthorized Provisional Companion Lessons | `superseded` |
| [ADR-0054](#adr-0054) | Provisional Memory Safety and Stewardship | `superseded` |
| [ADR-0055](#adr-0055) | Explicit Opt-In Provisional Companion Lessons | `superseded` |

<!-- legacy-adr:begin id=ADR-0052 source-file-sha256=490523148e5c3fd31cfeda62368bc71fc2ed7ff190d3c0bd167f4fb6636d1bbf -->
<a id="adr-0052"></a>

## ADR-0052: Explicit Memory Revision Authority

迁移时原路径：`docs/adr/0052-explicit-memory-revision-authority.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0052
title: "Explicit Memory Revision Authority"
status: superseded
date: 2026-07-27
decision_scope: cross-version
source_version: v0.13
supersedes: [ADR-0021, ADR-0033]
superseded_by: ADR-0069
```

<!-- legacy-adr-body:begin id=ADR-0052 -->
<a id="adr-0052-context"></a>
### Context

ADR-0021 modeled every `MemoryRevision` as content the user had confirmed, while ADR-0033 used
Revision `createdAt` as the confirmation time. That model is internally consistent only while an
Agent can save a non-effective Proposal and every effective Revision is created by a user command.

v0.13 introduces one narrowly preauthorized path that can make a Companion Lesson effective as a
provisional Revision without per-item confirmation. Treating that Revision as user-confirmed would
make the audit false. Storing `provisional` only on `Memory` would also lose the authority history
when the current Revision changes, and mutating the same Revision in place during confirmation
would weaken immutable revision evidence.

<a id="adr-0052-decision"></a>
### Decision

<a id="adr-0052-atomic-memory-and-immutable-content"></a>
#### Atomic Memory and immutable content

Each atomic long-term recognition remains one stable `Memory` with a permanent `memoryId`, a
selected current `MemoryRevision`, and optimistic Memory versioning.

Every `MemoryRevision`:

- has a stable `revisionId` and belongs to exactly one Memory;
- stores one complete canonical body;
- is immutable after publication except for the existing irreversible Forget clearing protocol;
- records one immutable authority value:

```text
user_confirmed
provisional
```

- records `createdAt` as Revision creation time, not as a universal confirmation timestamp;
- remains in revision history after it stops being current unless Forget clears its readable body.

The current Memory authority is the authority of its selected current Revision. Authority is not a
Memory Lifecycle value and does not add a fourth Lifecycle state.

<a id="adr-0052-revision-creation-rules"></a>
#### Revision creation rules

The following paths create a `user_confirmed` Revision:

- a user directly creates or revises Memory;
- a user accepts or edits and accepts a pending Proposal;
- a user confirms a current provisional Revision.

The bounded policy path defined by ADR-0053 creates a `provisional` Revision. No other Agent,
Runtime, confidence score, repeated observation or system component may choose provisional
authority.

Confirming an active provisional Revision creates a new immutable `user_confirmed` Revision with
the same canonical body and an explicit `confirmedFromRevisionId` link to the provisional base. It
uses `memoryId + expectedVersion + baseRevisionId` Compare-and-Set. This is the sole same-body
Revision operation and is not rejected as a content no-op because authority changes. Editing
provisional content through a user revise command instead creates an ordinary new
`user_confirmed` Revision.

Formal revision, confirmation and Proposal acceptance never overwrite a newer current Revision.
The stale Proposal rules in ADR-0038 continue to apply.

<a id="adr-0052-review-and-time"></a>
#### Review and time

v0.13 still has no `validFrom`, `validUntil` or automatic authority transition. Time alone never
confirms, retires, forgets or removes a Revision from Projection.

Default advisory Review is:

```text
provisional lesson      → Revision createdAt + 30 days
user-confirmed lesson   → Revision createdAt + 90 days
preference/agreement    → null
```

The user may reschedule Review for any active or retired Memory. Review due remains a Read Side
condition only.

Retire and eligible Reactivate preserve the current Revision and its authority. Reactivating a
provisional Memory must recheck both ordinary Scope capacity and the provisional capacity defined
by ADR-0053.

<a id="adr-0052-migration-and-read-surfaces"></a>
#### Migration and read surfaces

All readable Revisions created before the v0.13 migration are backfilled as `user_confirmed`.
Historical `createdAt` values are not rewritten.

Memory management, Projection, export and audit Read Sides must expose current Revision authority.
Agent-readable Projection does not expose user identity or command audit, but it must distinguish
confirmed and provisional entries as required by ADR-0054.

<a id="adr-0052-consequences"></a>
### Consequences

- The system can represent policy-authorized learning without falsely attributing confirmation to
  the user.
- Authority history remains tied to immutable content revisions and survives later revision.
- Same-body confirmation creates one additional Revision, but the audit can prove exactly which
  provisional content the user confirmed and when.
- Existing data migrates conservatively to `user_confirmed`; the migration does not infer new
  provisional content.
- Review can surface unattended provisional Lessons without silently changing their effect.
- Contracts, export format, Projection formatter and Memory tests must add authority coverage.

<a id="adr-0052-rejected-alternatives"></a>
### Rejected Alternatives

- Put `provisional` on Memory: loses the authority of historical Revisions and becomes ambiguous
  after revise.
- Mutate a provisional Revision to confirmed: weakens immutable revision evidence and erases the
  original authority transition.
- Treat `createdAt` as confirmation for every Revision: falsely labels policy-created content.
- Create a fourth Lifecycle state: mixes content authority with active/retired/forgotten usage.
- Automatically confirm after time or repetition: lets elapsed time or Agent behavior replace a
  user decision.

<a id="adr-0052-references"></a>
### References

- [v0.13 伙伴经验自动沉淀](README.md)
- [ADR-0019: Application-Global Memory Ownership](../v0.10/decisions.md#adr-0019)
- [ADR-0022: Immutable Memory Scope](../v0.10/decisions.md#adr-0022)
- [ADR-0024: Closed Memory Kinds](../v0.10/decisions.md#adr-0024)
- [ADR-0038: Memory Proposal Staleness](../v0.10/decisions.md#adr-0038)
- [ADR-0053: User-Preauthorized Provisional Companion Lessons](decisions.md#adr-0053)
- [Superseded ADR-0021](../v0.10/decisions.md#adr-0021)
- [Superseded ADR-0033](../v0.10/decisions.md#adr-0033)
<!-- legacy-adr-body:end id=ADR-0052 -->
<!-- legacy-adr:end id=ADR-0052 -->

<!-- legacy-adr:begin id=ADR-0053 source-file-sha256=a08a248d361483d05f5029770c1e6e07f877a5d456a47328df30463439ae3761 -->
<a id="adr-0053"></a>

## ADR-0053: User-Preauthorized Provisional Companion Lessons

迁移时原路径：`docs/adr/0053-user-preauthorized-provisional-companion-lessons.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0053
title: "User-Preauthorized Provisional Companion Lessons"
status: superseded
date: 2026-07-27
decision_scope: cross-version
source_version: v0.13
supersedes: [ADR-0032, ADR-0044]
superseded_by: ADR-0055
```

<!-- legacy-adr-body:begin id=ADR-0053 -->
<a id="adr-0053-context"></a>
### Context

Per-Proposal user confirmation gives strong governance for application-global Memory, but it also
makes every low-blast-radius self-learning event create review work. Companion Memory affects one
stable AgentProfile across Camps and Runtime changes; Hearth and Relationship Memory affect wider
collaboration boundaries.

Scope alone is not a sufficient automatic-learning gate. Existing `preference` and `agreement`
Kinds represent a user-confirmed choice or adopted rule, and automatic revise could replace a
previously confirmed current Revision. A stale revise Proposal also has no safe future acceptance
path. The automatic path therefore needs a closed eligibility matrix, a separate live user policy,
lower Revision authority, bounded growth and truthful receipts.

<a id="adr-0053-decision"></a>
### Decision

<a id="adr-0053-versioned-application-policy"></a>
#### Versioned application policy

Rovai-ai provides one application-global, versioned user setting:

```text
companionLessonAutoApplyEnabled: boolean
acknowledgedAt: timestamp?
```

An authenticated user updates it with optimistic expected-version control. Core reads the current
setting inside every `memory.propose_change` transaction; it is not frozen into AgentRun input.
Turning it off therefore stops new automatic applications immediately, including calls from a Run
that started while it was enabled.

Turning the setting off does not retire, confirm or forget existing provisional Memory. The UI must
state that it controls future automatic application and provide a direct route to the provisional
management view.

Fresh databases created at the v0.13 schema seed the setting on with `acknowledgedAt=null`. Before
the first Tool-enabled AgentRun, onboarding presents the preselected setting, its exact automatic
matrix and a direct way to turn it off; saving either choice records `acknowledgedAt`. Automatic
application requires a non-null acknowledgement, so a skipped or interrupted onboarding safely
uses the pending path. Databases upgraded from an earlier schema seed it off with
`acknowledgedAt=null` so an existing per-item confirmation contract is not silently weakened.

The existing frozen `memory.propose_change` Capability remains mandatory. Capability alone never
grants formal write authority; automatic application requires both the frozen Capability and the
live application policy.

<a id="adr-0053-closed-automatic-eligibility"></a>
#### Closed automatic eligibility

For Agent A in a current fenced AgentRun, a Proposal is eligible for automatic application only
when all conditions hold:

```text
action = add
scope = companion(A)
kind = lesson
companionLessonAutoApplyEnabled = true
acknowledgedAt is not null
policy-auto-applied Proposals from this sourceAgentRunId < 1
active provisional Memories for companion(A) < 8
ordinary Companion active count/byte capacity remains available
```

All existing validation remains mandatory: Native Binding and Execution Epoch fencing, current
Camp membership, frozen Capability, Scope derivation, closed Kind, 2 KiB body limit,
canonicalization, Secret Filter, exact active duplicate, pending duplicate, per-Run total Proposal
quota and SQLite transaction constraints.

Hearth, Relationship, Companion Preference, Companion Agreement and every revise Proposal remain
pending until an authenticated user accepts, edits and accepts, or rejects them. v0.13 never
automatically replaces a current Revision.

<a id="adr-0053-atomic-resolution-and-fallback"></a>
#### Atomic resolution and fallback

An eligible Proposal and its provisional Memory/Revision are committed in one SQLite immediate
transaction. The Proposal reaches terminal `accepted` status with:

```text
resolutionMode = policy_auto
policyVersion = the live setting version used by the transaction
acceptedMemoryId
acceptedRevisionId
```

The Revision is `provisional` under ADR-0052. Proposal provenance, Run quota, immutable Revision,
capacity, redacted event and idempotent command result remain in the same transaction.

The successful tool receipt is a discriminated result:

```json
{
  "rovaiTeamTool": "memory.propose_change",
  "rovaiTeamReceipt": "Provisional Companion Lesson applied under user policy; not user-confirmed.",
  "proposalId": "...",
  "status": "accepted",
  "resolutionMode": "policy_auto",
  "effective": true,
  "authority": "provisional",
  "memoryId": "...",
  "revisionId": "..."
}
```

If the policy is off, the Scope/Kind/action is outside the closed automatic matrix, the per-Run
automatic budget is consumed, or provisional/ordinary active capacity is full, a valid Proposal
uses the existing pending path and returns `effective=false`. Capacity fallback never evicts,
retires, merges or truncates another Memory.

An invalid, unauthorized, secret-containing, exact no-op, duplicate or already-stale request
retains its existing failure semantics. In particular, a revise whose `baseRevisionId` is already
obsolete persists no Proposal; CAS conflict does not degrade to pending.

User-accepted Proposals record `resolutionMode=user`. Remaining pending Proposals retain
per-Proposal acceptance, edit-and-accept and rejection; batch acceptance remains unavailable and
batch rejection remains allowed. Before manual acceptance, the UI presents the complete final
body, Scope, Kind and Relationship Direction where applicable. User edits repeat canonicalization,
Secret Filter, Scope/Kind, capacity and CAS validation. Stale acceptance/edit controls remain
disabled with an explicit reason. Dismissing a session notice performs no domain transition.

<a id="adr-0053-sqlite-authority-and-live-projection"></a>
#### SQLite authority and live Projection

SQLite remains the sole authoritative source for Memory, Revision, Proposal, Supersession, policy
and bounded text. All formal changes use typed Core commands, idempotency, expected versions and
redacted events. Renderer, Runtime and Markdown cannot write authority directly.

Current authorized state is projected into deterministic read-only Markdown under private
`userData`. Projection remains disposable, atomically replaceable and reconciled after commit.
Projection failure never rolls back SQLite and continues to fail closed under ADR-0042.

AgentRun input continues to freeze a short Memory Guide, allowed path list, formatter version and
observed digests without embedding Memory bodies. Runtime Agents read live files through native
tools and may observe a later automatic application during the same Run. Content already read into
a Native Session cannot be removed from that session by later undo or Forget.

A Runtime without reliable native file-read capability or permission reports Memory unavailable.
Rovai-ai does not silently fall back to body injection, a hidden prompt channel or a per-Run
Markdown copy.

Core exposes only Scope paths allowed for the Agent. As before, same-OS-user filesystem access is
not claimed as a strict security sandbox.

<a id="adr-0053-user-visibility-and-narrow-undo"></a>
#### User visibility and narrow undo

Every automatic application emits a body-free event containing Proposal, Memory, Revision,
Companion and resolution identifiers. Renderer may aggregate same-session notices, but transient
notification is not the sole discovery surface: Memory management shows a persistent provisional
filter and per-Companion active provisional count.

The user may confirm, edit and confirm, retire, forget or review a provisional Memory. A dedicated
`memory.autoApply.undo` user command is available only when:

- the Memory was created by one `policy_auto` add Proposal;
- its current Revision is still that provisional Revision;
- no later Revision, Lifecycle change or Supersession has changed the Memory;
- `memoryId + expectedVersion + revisionId` still match.

The command performs Memory-Domain Forget clearing in one transaction, but its UI label must say
that it “撤销并从长期记忆中删除该自动记忆”. It must not claim to erase content already read
by a Runtime, Native Session, exported file or external backup. If preconditions are stale, the
command fails without deleting newer or user-confirmed history.

<a id="adr-0053-consequences"></a>
### Consequences

- Low-blast-radius Companion Lessons can become useful without creating one confirmation prompt
  per item.
- Preference, Agreement, Relationship, Hearth and revision authority remain user-confirmed.
- One Run can automatically add at most one effective item and one Companion can hold at most
  eight active provisional items; the existing total capacity remains an additional bound.
- The same tool may truthfully return either effective provisional or pending, so Skill and Runtime
  integrations must inspect receipt fields rather than assume one outcome.
- Live Projection means an active Run may observe its own newly created provisional Lesson.
- Upgraded users retain the old confirmation behavior until they explicitly enable the policy.
- Existing provisional items remain active when the policy is disabled and require separate user
  governance.

<a id="adr-0053-rejected-alternatives"></a>
### Rejected Alternatives

- Automatically apply every Companion Proposal: lets Preferences, Agreements and revisions bypass
  their stronger semantics.
- Automatically revise user-confirmed Memory: can replace an explicit user decision before review.
- Use model confidence, repetition or multiple-Agent voting: does not create user authorization.
- Fall back stale revise to pending: stores an item with no legal acceptance path.
- Use the ordinary four-Proposal Run quota as the automatic budget: can fill a Companion working
  set after only sixteen maximally active Runs.
- Automatically expire or evict provisional Memory: makes time or capacity silently change durable
  behavior.
- Map generic toast Undo directly to unrestricted Forget: can destroy older confirmed Revision
  history after an intervening change.

<a id="adr-0053-references"></a>
### References

- [v0.13 伙伴经验自动沉淀](README.md)
- [ADR-0019: Application-Global Memory Ownership](../v0.10/decisions.md#adr-0019)
- [ADR-0024: Closed Memory Kinds](../v0.10/decisions.md#adr-0024)
- [ADR-0027: Memory-Domain Forgetting](../v0.10/decisions.md#adr-0027)
- [ADR-0038: Memory Proposal Staleness](../v0.10/decisions.md#adr-0038)
- [ADR-0039: Memory Proposal Capability](../v0.10/decisions.md#adr-0039)
- [ADR-0040: Terminal Memory Proposal Retention](../v0.10/decisions.md#adr-0040)
- [ADR-0042: Fail-Closed Memory Projection](../v0.10/decisions.md#adr-0042)
- [ADR-0052: Explicit Memory Revision Authority](decisions.md#adr-0052)
- [ADR-0054: Provisional Memory Safety and Stewardship](decisions.md#adr-0054)
- [Superseded ADR-0032](../v0.10/decisions.md#adr-0032)
- [Superseded ADR-0044](../v0.10/decisions.md#adr-0044)
<!-- legacy-adr-body:end id=ADR-0053 -->
<!-- legacy-adr:end id=ADR-0053 -->

<!-- legacy-adr:begin id=ADR-0054 source-file-sha256=1a5cc6157b944ce5be90609cc4e77a31951ebd9da40b53bd45ee3b22fcb51a64 -->
<a id="adr-0054"></a>

## ADR-0054: Provisional Memory Safety and Stewardship

迁移时原路径：`docs/adr/0054-provisional-memory-safety-and-stewardship.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0054
title: "Provisional Memory Safety and Stewardship"
status: superseded
date: 2026-07-27
decision_scope: cross-version
source_version: v0.13
supersedes: [ADR-0043, ADR-0046]
superseded_by: ADR-0055
```

<!-- legacy-adr-body:begin id=ADR-0054 -->
<a id="adr-0054-context"></a>
### Context

ADR-0043's Secret Filter and ADR-0046's Memory Stewardship Skill assumed every effective Memory
body had received per-item user confirmation. Under ADR-0053, one Companion Lesson may instead
become effective under an application-level preauthorization policy.

That lower-friction path creates two risks that a `provisional` label must address honestly:
ordinary personal context can persist without a per-item review, and Agent-generated text can act
as cross-Camp persistent prompt injection when a Runtime later reads the live Projection. Model
guidance cannot replace Core enforcement, but Projection and Skill semantics must prevent
provisional content from being presented as a user statement, permission or confirmed rule.

<a id="adr-0054-decision"></a>
### Decision

<a id="adr-0054-non-overridable-secret-filter"></a>
#### Non-overridable Secret Filter

Core continues to apply one deterministic, non-overridable Memory Secret Filter before any
Proposal or Revision body is persisted. It covers Agent add/revise, policy-auto application, user
direct create/revise, user acceptance edits and future import paths.

The filter rejects high-confidence credential material such as passwords, API/access tokens,
private keys and authentication headers. No user, Agent Capability, policy or Scope may override
it. Rejection persists no candidate body, and events, results, receipts, diagnostics, telemetry and
test snapshots contain only stable non-sensitive codes.

v0.13 does not add a model-authored sensitivity score, personality profile, quarantine Lifecycle
or generic `sensitive` Kind. Model classification is not a Core security boundary.

<a id="adr-0054-ordinary-personal-context"></a>
#### Ordinary personal context

Ordinary personal context remains legal only when it fits the closed preference/agreement/lesson
Kinds and the selected Scope. Per-item user confirmation remains mandatory except for the exact
provisional Companion Lesson policy in ADR-0053.

Enabling that policy is explicit user preauthorization to persist qualifying ordinary personal
context for one Companion's future Runs. Fresh-install onboarding presents the default-on policy
before the first Tool-enabled AgentRun and records the user's preselected or changed choice; the
setting UI continues to disclose the same behavior. Upgrades default the policy off. The product
must not describe the deterministic Secret Filter as a general personal-data classifier.

<a id="adr-0054-provisional-authority-in-agent-context"></a>
#### Provisional authority in Agent context

Projection renders confirmed and provisional entries in separate deterministic sections, with
confirmed entries first. Every provisional entry includes a textual `authority: provisional`
marker in addition to stable Memory/Revision identity. Memory bodies remain indented or otherwise
quoted as data rather than concatenated into the Guide as instructions.

The Memory Guide and Stewardship Skill define this authority order:

1. current user input, Work Brief or Task, permissions, current collaboration and repository state;
2. applicable user-confirmed Memory;
3. applicable provisional Memory as an unconfirmed working hypothesis.

Provisional Memory:

- is not a user statement, Agreement, permission or security decision;
- cannot grant Tool, Capability, Scope, approval or action authority;
- cannot override conflicting confirmed Memory;
- should be ignored or raised to the user when conflict or material uncertainty remains.

These instructions reduce accidental misuse but do not claim that prompt text provides a strict
security sandbox. Core authorization, Secret Filter, action safety, Scope and quotas remain
independent enforcement.

<a id="adr-0054-memory-stewardship-skill-v2"></a>
#### Memory Stewardship Skill v2

Rovai-ai continues to ship one Bundled Skill named `memory-stewardship`, displayed as
“共同记忆维护”, enabled by default for Runtime Agents that support Skills and user-disableable.
Distribution continues to reuse immutable SkillRevision, Runtime-native SkillProjection, project
same-name shadowing and ContextManifest digests.

The Skill teaches the Agent to:

1. distinguish durable collaboration learning from task state, repository facts, personal
   profiling, capability scoring or instructions copied from untrusted content;
2. read only currently authorized Projection paths when relevant;
3. prefer confirmed Memory and treat provisional entries as hypotheses;
4. avoid exact duplicates and choose a legal Scope, Kind and Relationship Direction;
5. write one atomic canonical body without credentials;
6. submit add or revise only through `memory.propose_change`;
7. inspect the receipt:
   - `effective=true + authority=provisional` means a bounded Lesson is active but not
     user-confirmed;
   - `effective=false + status=pending` means it awaits user confirmation;
8. never claim that provisional content was confirmed by the user.

Skill enablement grants no Capability or policy permission. A project same-name Skill may change
guidance but cannot relax Gateway validation. Unsupported Runtimes expose the existing visible
degradation; Rovai-ai does not inject a hidden fallback Skill or Memory body into the System
Prompt.

<a id="adr-0054-consequences"></a>
### Consequences

- Credential handling remains fail closed across both manual and automatic paths.
- Users receive an explicit product-level privacy choice instead of a false claim that credential
  filtering covers all personal information.
- Confirmed and provisional context have a visible, stable authority ordering.
- Persistent prompt-injection risk is reduced by closed auto eligibility, quoted projection,
  lower authority and Core-independent safety checks, but cannot be claimed eliminated for a
  model reading arbitrary local text.
- The existing Skill and Projection formatter require new revisions and digest changes.
- Runtime integrations must not translate an effective provisional receipt into “the user taught
  me” or equivalent confirmation language.

<a id="adr-0054-rejected-alternatives"></a>
### Rejected Alternatives

- Rely only on the model to classify secrets or sensitive data: nondeterministic output cannot
  enforce persistence safety.
- Present provisional and confirmed entries identically: makes the authority distinction cosmetic.
- Treat provisional Memory as an instruction channel: creates a persistent privilege-escalation
  path across Camps.
- Add a generic personality or observation profile: conflicts with the closed Memory Kind model.
- Put the complete Memory body in the Guide: consumes context and bypasses native on-demand reads.
- Let Skill text grant automatic authority: confuses guidance with Core policy.

<a id="adr-0054-references"></a>
### References

- [v0.13 伙伴经验自动沉淀](README.md)
- [ADR-0015: Action and Safety v2](../v0.06/decisions.md#adr-0015)
- [ADR-0017: Managed Skill Library and Runtime-Native Projection](../v0.08/decisions.md#adr-0017)
- [ADR-0024: Closed Memory Kinds](../v0.10/decisions.md#adr-0024)
- [ADR-0027: Memory-Domain Forgetting](../v0.10/decisions.md#adr-0027)
- [ADR-0039: Memory Proposal Capability](../v0.10/decisions.md#adr-0039)
- [ADR-0042: Fail-Closed Memory Projection](../v0.10/decisions.md#adr-0042)
- [ADR-0052: Explicit Memory Revision Authority](decisions.md#adr-0052)
- [ADR-0053: User-Preauthorized Provisional Companion Lessons](decisions.md#adr-0053)
- [Superseded ADR-0043](../v0.10/decisions.md#adr-0043)
- [Superseded ADR-0046](../v0.10/decisions.md#adr-0046)
<!-- legacy-adr-body:end id=ADR-0054 -->
<!-- legacy-adr:end id=ADR-0054 -->

<!-- legacy-adr:begin id=ADR-0055 source-file-sha256=0440f404d3d4af53ccdc384c1ce7e5c912e350121801c0305ef942796cf684af -->
<a id="adr-0055"></a>

## ADR-0055: Explicit Opt-In Provisional Companion Lessons

迁移时原路径：`docs/adr/0055-explicit-opt-in-provisional-companion-lessons.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0055
title: "Explicit Opt-In Provisional Companion Lessons"
status: superseded
date: 2026-07-27
decision_scope: cross-version
source_version: v0.13
supersedes: [ADR-0053, ADR-0054]
superseded_by: ADR-0064
```

<!-- legacy-adr-body:begin id=ADR-0055 -->
<a id="adr-0055-context"></a>
### Context

ADR-0053 introduced an application-global policy that could automatically apply one narrow class
of Agent-authored Memory as provisional authority. ADR-0054 defined the safety and stewardship
rules for that lower-authority content. Their fresh-install flow preselected the policy on and
required a startup onboarding dialog before automatic application became possible.

The startup dialog interrupts users before they have reached the Memory feature or seen a working
AgentRun. Dismissing it leaves an unacknowledged intermediate state, while the durable Memory
settings page already has the context and disclosure needed for an informed choice. Automatic
persistence of ordinary personal context should be an explicit opt-in at that durable surface,
not a preselected startup decision.

<a id="adr-0055-decision"></a>
### Decision

<a id="adr-0055-non-blocking-default-off-application-policy"></a>
#### Non-blocking, default-off application policy

Rovai-ai retains one application-global, versioned policy:

```text
companionLessonAutoApplyEnabled: boolean
acknowledgedAt: timestamp?
```

The policy defaults to `false`. App startup, opening a new conversation, member setup and the first
Tool-enabled AgentRun never open a policy dialog. The Memory settings page is the sole product
surface for enabling or disabling automatic provisional Companion Lessons.

An authenticated user explicitly enabling or disabling the setting writes the selected boolean,
`acknowledgedAt=now`, a new policy version and a body-free audit event under expected-version CAS.
The default-off state may retain `acknowledgedAt=null`; absence of acknowledgement never weakens
the pending Proposal path.

Migration v24 changes only a legacy policy that is both enabled and unacknowledged: it becomes
disabled and receives a new version without inventing a user acknowledgement. Already acknowledged
enabled or disabled choices are preserved. Existing provisional Memories are not confirmed,
retired, forgotten or otherwise changed by migration or by disabling the policy.

<a id="adr-0055-closed-automatic-eligibility"></a>
#### Closed automatic eligibility

Core reads the live policy inside every `memory.propose_change` transaction. Automatic application
requires all of the following:

```text
action = add
scope = companion(current Agent)
kind = lesson
companionLessonAutoApplyEnabled = true
acknowledgedAt is not null
policy-auto-applied Proposals from this sourceAgentRunId < 1
active provisional Memories for this Companion < 8
ordinary Companion count and byte capacity remains available
```

The frozen `memory.propose_change` Capability remains independently mandatory. A member-level or
Camp-level capability toggle only controls whether an Agent may propose Memory; it does not enable
the application-global automatic policy. The policy does not grant Tool, Capability, Scope or
action authority.

Hearth, Relationship, Preference, Agreement and every revise Proposal remain pending until an
authenticated user accepts, edits and accepts, or rejects them. Policy-off, quota and capacity
fallbacks also remain pending. Invalid, unauthorized, secret-containing, duplicate, exact no-op,
stale or fenced requests retain failure semantics and do not become pending merely because the
automatic path is unavailable.

Eligible automatic application remains atomic: Proposal acceptance, provisional Memory and
Revision, `resolutionMode=policy_auto`, policy version, event and idempotent command result commit
in the same SQLite transaction. Receipts must state that the Memory is effective provisional
authority and is not user-confirmed.

<a id="adr-0055-provisional-safety-and-stewardship"></a>
#### Provisional safety and stewardship

The deterministic, non-overridable Secret Filter remains mandatory for every Memory persistence
path. It rejects high-confidence credential material without echoing matched content, but the
product must not describe it as a general personal-data classifier.

Confirmed and provisional entries remain separate in deterministic read-only Projection, with
confirmed content first and every provisional entry carrying an explicit authority marker.
Runtime guidance and the `memory-stewardship` Skill must preserve this order:

1. current user input, current authorization and repository state;
2. applicable user-confirmed Memory;
3. applicable provisional Memory as an unconfirmed working hypothesis.

Provisional content is not a user statement, Agreement, permission or security decision. It cannot
grant authority or override current input or confirmed Memory. The user can confirm, edit and
confirm, retire, forget, review or narrowly undo an unchanged policy-auto add. UI and export text
must not claim removal from an already-read Native Session or external copy.

SQLite remains authoritative. Renderer, Runtime, Skill text and Markdown Projection cannot write
formal Memory authority directly.

<a id="adr-0055-consequences"></a>
### Consequences

- App startup and new-conversation entry remain uninterrupted.
- No automatic provisional Memory is possible until the user actively enables it in Memory
  settings.
- Member management continues to expose Proposal Capability independently, avoiding a misleading
  per-member interpretation of the global automatic policy.
- Existing acknowledged choices survive upgrade; legacy preselected-but-unacknowledged choices
  fail closed to disabled.
- The lower-authority Projection, quotas, receipts, review actions, Secret Filter and stewardship
  constraints remain unchanged.

<a id="adr-0055-rejected-alternatives"></a>
### Rejected Alternatives

- Keep the startup dialog but default it off: still interrupts unrelated startup work.
- Treat closing the dialog as consent: dismissal is not an explicit persistence choice.
- Seed the policy off with a fabricated acknowledgement timestamp: misrepresents a system default
  as a user decision.
- Put the global policy inside each member form: implies per-member semantics that the authoritative
  singleton policy does not provide.
- Remove automatic provisional Lessons entirely: discards the bounded opt-in path instead of
  improving its consent surface.

<a id="adr-0055-references"></a>
### References

- [v0.13 伙伴经验自动沉淀](README.md)
- [ADR-0019: Application-Global Memory Ownership](../v0.10/decisions.md#adr-0019)
- [ADR-0039: Memory Proposal Capability](../v0.10/decisions.md#adr-0039)
- [ADR-0042: Fail-Closed Memory Projection](../v0.10/decisions.md#adr-0042)
- [ADR-0052: Explicit Memory Revision Authority](decisions.md#adr-0052)
- [Superseded ADR-0053](decisions.md#adr-0053)
- [Superseded ADR-0054](decisions.md#adr-0054)
<!-- legacy-adr-body:end id=ADR-0055 -->
<!-- legacy-adr:end id=ADR-0055 -->
