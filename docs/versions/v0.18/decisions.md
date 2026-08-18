---
document_type: version-decisions
version: v0.18
lifecycle: historical
last_updated: 2026-08-18
---

# v0.18 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0064](#adr-0064) | Default-On Bounded Automatic Partner Memory Formation | `superseded` |

<!-- legacy-adr:begin id=ADR-0064 source-file-sha256=91a8b46061311e5ca2a01b98e743ef7213c2805ee176ffdad34fb757f159f97a -->
<a id="adr-0064"></a>

## ADR-0064: Default-On Bounded Automatic Partner Memory Formation

迁移时原路径：`docs/adr/0064-default-on-bounded-automatic-partner-memory.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0064
title: "Default-On Bounded Automatic Partner Memory Formation"
status: superseded
date: 2026-07-28
decision_scope: cross-version
source_version: v0.18
supersedes: [ADR-0055]
superseded_by: ADR-0069
```

<!-- legacy-adr-body:begin id=ADR-0064 -->
<a id="adr-0064-context"></a>
### Context

ADR-0055 allowed an Agent to automatically add only one
`Companion(current Agent) + Lesson` Memory after the user explicitly enabled a
default-off application policy. Companion Preferences, Companion Agreements and
all Relationship Memories still became pending Proposals.

That matrix is narrower than the product meaning of long-term partner memory.
Durable learning about one partner can be a Preference, Agreement or Lesson,
while durable learning between two partners is often an Agreement or Lesson.
Making the latter wait for per-item confirmation prevents “协作默契” from being
formed through ordinary collaboration even when the user has enabled automatic
formation.

The existing term “未确认” also makes an effective provisional Memory look like
unfinished work. A provisional Revision is already active lower-authority
guidance; confirmation is an optional authority upgrade, not its activation
step. The product therefore needs one coherent default policy, a closed
automatic matrix, bounded growth and a truthful distinction between pending
Proposals, automatically formed Memory and explicitly confirmed Memory.

<a id="adr-0064-decision"></a>
### Decision

<a id="adr-0064-default-enabled-application-policy"></a>
#### Default-enabled application policy

Rovai-ai exposes one application-global, versioned policy:

```text
automaticPartnerMemoryEnabled: boolean
```

The policy defaults to `true`. It has no acknowledgement gate, so the first
eligible AgentRun may form Memory automatically. App startup, new conversation,
member setup and AgentRun startup do not show a blocking consent dialog.

The long-term memory page is the durable product surface for changing the
policy. An authenticated user change uses expected-version Compare-and-Set and
records a body-free audit event. Disabling the policy affects only future
Proposals; it never confirms, retires, forgets or otherwise changes existing
Memory.

This contract replaces the unreleased `companionLessonAutoApplyEnabled` and
`acknowledgedAt` contract directly. No compatibility alias, legacy default or
synthesized acknowledgement is part of the target architecture.

<a id="adr-0064-closed-automatic-eligibility"></a>
#### Closed automatic eligibility

Core reads the live policy inside every `memory.propose_change` transaction.
Automatic formation is available only to `add` Proposals from the current,
fenced AgentRun:

| Scope | Legal Kind | Legal identity and direction |
|---|---|---|
| Companion | Preference, Agreement, Lesson | `Companion(current Agent)` |
| Relationship | Agreement, Lesson | the current Agent and one present counterparty from the same Camp; either `mutual` or `directed(current Agent → counterparty)` |
| Hearth | none | always requires an explicit user decision |

Relationship Preference remains illegal under the closed Scope/Kind model. A
directed automatic Relationship never points from the counterparty to the
proposing Agent.

Automatic formation additionally requires:

- the frozen AgentRun Capability to permit `memory.propose_change`;
- a valid current Agent and, for Relationship, a valid present counterparty;
- canonical content that passes the non-overridable Memory Secret Filter,
  duplicate checks and all Scope/Kind/direction validation;
- fewer than one already automatically formed Memory from the same
  `sourceAgentRunId`;
- fewer than eight active policy-auto provisional Memories in the target
  Companion scope, or fewer than eight for the target unordered Relationship
  pair;
- all ordinary Memory and byte-capacity constraints to remain available.

The one-per-Run limit is shared across Companion and Relationship. The
Relationship limit is shared by both directions and mutual Memory for the same
unordered pair.

An otherwise valid Proposal falls back to `pending` when the policy is disabled
or an automatic Run, scope or ordinary capacity bound prevents formation.
Invalid, unauthorized, secret-containing, duplicate, exact no-op, stale or
fenced requests retain their normal failure semantics and do not become pending
merely because automatic formation failed.

Every `revise` Proposal remains pending for an explicit user decision. Retire,
reactivate, review, confirm and Forget remain user-only lifecycle or governance
operations. No policy path automatically replaces an existing Revision.

<a id="adr-0064-immediately-effective-provisional-authority"></a>
#### Immediately effective provisional authority

An eligible automatic `add` atomically persists:

- the originating Proposal and its `policy_auto` resolution;
- a new active Memory and immutable `provisional` MemoryRevision;
- the policy version used for the decision;
- a body-free domain event and idempotent command result.

The new Memory is effective immediately. It does not require later confirmation
and must not appear as pending work.

Authority order remains:

1. current user input, current authorization and current repository or
   collaboration state;
2. applicable `user_confirmed` Memory;
3. applicable `provisional` Memory as lower-priority guidance.

A provisional Preference or Agreement can guide subsequent collaboration, but
it is not a statement attributed to the user, cannot grant permissions or
Capabilities, cannot satisfy an approval, and cannot override current input or
conflicting confirmed Memory.

The user may optionally choose “标记为已确认”. Confirmation creates the
same-body immutable `user_confirmed` Revision and preserves the provisional
Revision as audit history under ADR-0052. It releases the applicable provisional
scope capacity. Editing a provisional Memory through the ordinary user revise
flow likewise creates a `user_confirmed` Revision.

Existing advisory Review defaults remain unchanged: provisional Lessons receive
the existing 30-day default, while Preference and Agreement have no automatic
review date unless the user schedules one. Time never confirms, retires, forgets
or evicts Memory.

<a id="adr-0064-durable-visibility-and-user-governance"></a>
#### Durable visibility and user governance

Every successful automatic formation produces one non-blocking, dismissible
notice naming whether a “伙伴经验” or “协作默契” was formed and offering
“查看”. Dismissing the notice has no domain effect.

The durable memory list labels a currently provisional policy-auto Memory as
“自动形成”, not “未确认”. Optional confirmation changes its current authority
label to “已确认”, while detail and audit history continue to show that its
origin was automatic.

Ordinary pending Proposals remain a separate queue that requires accept,
edit-and-accept or reject. Automatically formed Memory never enters that queue.
The user can stop using or Forget one automatic Memory through the same explicit
operations available to other Memory. Turning the global policy off is not a
bulk removal operation.

Receipts must distinguish:

```text
effective=true  + authority=provisional + resolutionMode=policy_auto
effective=false + proposalStatus=pending
```

Neither result may claim explicit user confirmation.

<a id="adr-0064-safety-projection-and-authority"></a>
#### Safety, projection and authority

SQLite remains the sole authoritative source for policy, Proposal, Memory,
Revision and lifecycle state. Renderer, Runtime, Skill text and Markdown
Projection cannot write formal Memory authority directly.

The deterministic Memory Secret Filter remains mandatory for every persistence
path. Confirmed and provisional entries remain separate in read-only Projection,
with confirmed content first and every provisional entry carrying a textual
authority marker. Memory bodies remain quoted data rather than being merged into
the Memory Guide as instructions.

The `memory-stewardship` Skill and Runtime guidance must teach the complete
automatic matrix, receipt distinction and authority order. Skill enablement
does not grant Capability or policy permission.

<a id="adr-0064-consequences"></a>
### Consequences

- Companion Preferences, Agreements and Lessons can form automatically, and
  Relationship Agreements and Lessons can now become durable collaboration
  guidance without per-item confirmation.
- Hearth, all revisions and all lifecycle operations keep explicit user
  governance.
- The policy is opt-out and can affect the first eligible Run, so durable page
  copy, per-formation notice, lower authority, Secret Filter and strict quotas
  are mandatory safeguards.
- Confirmation becomes an optional endorsement and capacity-management action
  instead of a hidden activation requirement.
- One Run can add at most one automatic Memory; each Companion and each
  unordered Relationship pair can hold at most eight active policy-auto
  provisional Memories in addition to ordinary total-capacity constraints.
- Contracts, Core policy naming, receipts, Projection, bundled Skill, tests and
  UI labels must replace the unreleased Companion-Lesson-only vocabulary.
- Existing Memories remain stable when the policy changes; users govern them
  individually through confirm, revise, Review, stop using or Forget.

<a id="adr-0064-rejected-alternatives"></a>
### Rejected Alternatives

- Keep automatic formation limited to Companion Lessons: excludes durable
  Preferences, Agreements and collaboration learning between partners.
- Include Hearth in automatic formation: lets one Agent create guidance that
  affects every partner without an explicit user decision.
- Automatically apply `revise` Proposals: allows an Agent to replace an
  existing current Revision before user review.
- Require confirmation before an automatic Memory becomes effective: recreates
  the pending Proposal workflow and makes “automatic formation” misleading.
- Store automatically formed content as `user_confirmed`: falsely attributes
  Agent-authored content and removes conflict-ordering safeguards.
- Remove the optional confirmation action: prevents explicit endorsement,
  conflict-priority upgrade and deliberate provisional-capacity release.
- Automatically retire all provisional Memory when the policy is disabled:
  turns one future-facing setting into a surprising bulk lifecycle operation.
- Use one unbounded global pool or independent direction quotas: permits one
  partner or pair to grow without a stable local bound.
- Preserve default-off acknowledgement compatibility: retains an unreleased
  intermediate contract that conflicts with the chosen default-on experience.

<a id="adr-0064-references"></a>
### References

- [Current memory UI design](../../../apps/desktop/.impeccable/surfaces/memory-workspace.md)
- [ADR-0019: Application-Global Memory Ownership](../v0.10/decisions.md#adr-0019)
- [ADR-0024: Closed Memory Kinds](../v0.10/decisions.md#adr-0024)
- [ADR-0027: Memory-Domain Forgetting](../v0.10/decisions.md#adr-0027)
- [ADR-0035: User-Transparent, Agent-Applicable Relationship Memory](../v0.10/decisions.md#adr-0035)
- [ADR-0036: Agent-Bounded Memory Proposal Scope](../v0.10/decisions.md#adr-0036)
- [ADR-0037: Actor-Bounded Relationship Proposal Direction](../v0.10/decisions.md#adr-0037)
- [ADR-0039: Memory Proposal Capability](../v0.10/decisions.md#adr-0039)
- [ADR-0042: Fail-Closed Memory Projection](../v0.10/decisions.md#adr-0042)
- [ADR-0052: Explicit Memory Revision Authority](../v0.13/decisions.md#adr-0052)
- [Superseded ADR-0055](../v0.13/decisions.md#adr-0055)
<!-- legacy-adr-body:end id=ADR-0064 -->
<!-- legacy-adr:end id=ADR-0064 -->
