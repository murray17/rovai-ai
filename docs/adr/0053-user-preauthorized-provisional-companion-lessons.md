---
document_type: adr
id: ADR-0053
title: "User-Preauthorized Provisional Companion Lessons"
status: accepted
date: 2026-07-27
decision_scope: cross-version
source_version: v0.13
supersedes: [ADR-0032, ADR-0044]
superseded_by: null
---

# ADR-0053: User-Preauthorized Provisional Companion Lessons

## Context

Per-Proposal user confirmation gives strong governance for application-global Memory, but it also
makes every low-blast-radius self-learning event create review work. Companion Memory affects one
stable AgentProfile across Camps and Runtime changes; Hearth and Relationship Memory affect wider
collaboration boundaries.

Scope alone is not a sufficient automatic-learning gate. Existing `preference` and `agreement`
Kinds represent a user-confirmed choice or adopted rule, and automatic revise could replace a
previously confirmed current Revision. A stale revise Proposal also has no safe future acceptance
path. The automatic path therefore needs a closed eligibility matrix, a separate live user policy,
lower Revision authority, bounded growth and truthful receipts.

## Decision

### Versioned application policy

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

### Closed automatic eligibility

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

### Atomic resolution and fallback

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

### SQLite authority and live Projection

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

### User visibility and narrow undo

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

## Consequences

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

## Rejected Alternatives

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

## References

- [v0.13 伙伴经验自动沉淀](../versions/v0.13/README.md)
- [ADR-0019: Application-Global Memory Ownership](0019-application-global-memory-ownership.md)
- [ADR-0024: Closed Memory Kinds](0024-closed-memory-kinds.md)
- [ADR-0027: Memory-Domain Forgetting](0027-memory-domain-forgetting.md)
- [ADR-0038: Memory Proposal Staleness](0038-memory-proposal-staleness.md)
- [ADR-0039: Memory Proposal Capability](0039-memory-proposal-capability.md)
- [ADR-0040: Terminal Memory Proposal Retention](0040-terminal-memory-proposal-retention.md)
- [ADR-0042: Fail-Closed Memory Projection](0042-fail-closed-memory-projection.md)
- [ADR-0052: Explicit Memory Revision Authority](0052-explicit-memory-revision-authority.md)
- [ADR-0054: Provisional Memory Safety and Stewardship](0054-provisional-memory-safety-and-stewardship.md)
- [Superseded ADR-0032](0032-user-authorized-live-memory-projection.md)
- [Superseded ADR-0044](0044-per-proposal-user-confirmation.md)
