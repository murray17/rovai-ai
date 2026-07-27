---
document_type: adr
id: ADR-0055
title: "Explicit Opt-In Provisional Companion Lessons"
status: accepted
date: 2026-07-27
decision_scope: cross-version
source_version: v0.13
supersedes: [ADR-0053, ADR-0054]
superseded_by: null
---

# ADR-0055: Explicit Opt-In Provisional Companion Lessons

## Context

ADR-0053 introduced an application-global policy that could automatically apply one narrow class
of Agent-authored Memory as provisional authority. ADR-0054 defined the safety and stewardship
rules for that lower-authority content. Their fresh-install flow preselected the policy on and
required a startup onboarding dialog before automatic application became possible.

The startup dialog interrupts users before they have reached the Memory feature or seen a working
AgentRun. Dismissing it leaves an unacknowledged intermediate state, while the durable Memory
settings page already has the context and disclosure needed for an informed choice. Automatic
persistence of ordinary personal context should be an explicit opt-in at that durable surface,
not a preselected startup decision.

## Decision

### Non-blocking, default-off application policy

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

### Closed automatic eligibility

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

### Provisional safety and stewardship

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

## Consequences

- App startup and new-conversation entry remain uninterrupted.
- No automatic provisional Memory is possible until the user actively enables it in Memory
  settings.
- Member management continues to expose Proposal Capability independently, avoiding a misleading
  per-member interpretation of the global automatic policy.
- Existing acknowledged choices survive upgrade; legacy preselected-but-unacknowledged choices
  fail closed to disabled.
- The lower-authority Projection, quotas, receipts, review actions, Secret Filter and stewardship
  constraints remain unchanged.

## Rejected Alternatives

- Keep the startup dialog but default it off: still interrupts unrelated startup work.
- Treat closing the dialog as consent: dismissal is not an explicit persistence choice.
- Seed the policy off with a fabricated acknowledgement timestamp: misrepresents a system default
  as a user decision.
- Put the global policy inside each member form: implies per-member semantics that the authoritative
  singleton policy does not provide.
- Remove automatic provisional Lessons entirely: discards the bounded opt-in path instead of
  improving its consent surface.

## References

- [v0.13 伙伴经验自动沉淀](../versions/v0.13/README.md)
- [ADR-0019: Application-Global Memory Ownership](0019-application-global-memory-ownership.md)
- [ADR-0039: Memory Proposal Capability](0039-memory-proposal-capability.md)
- [ADR-0042: Fail-Closed Memory Projection](0042-fail-closed-memory-projection.md)
- [ADR-0052: Explicit Memory Revision Authority](0052-explicit-memory-revision-authority.md)
- [Superseded ADR-0053](0053-user-preauthorized-provisional-companion-lessons.md)
- [Superseded ADR-0054](0054-provisional-memory-safety-and-stewardship.md)
