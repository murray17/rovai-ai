---
document_type: adr
id: ADR-0054
title: "Provisional Memory Safety and Stewardship"
status: superseded
date: 2026-07-27
decision_scope: cross-version
source_version: v0.13
supersedes: [ADR-0043, ADR-0046]
superseded_by: ADR-0055
---

# ADR-0054: Provisional Memory Safety and Stewardship

## Context

ADR-0043's Secret Filter and ADR-0046's Memory Stewardship Skill assumed every effective Memory
body had received per-item user confirmation. Under ADR-0053, one Companion Lesson may instead
become effective under an application-level preauthorization policy.

That lower-friction path creates two risks that a `provisional` label must address honestly:
ordinary personal context can persist without a per-item review, and Agent-generated text can act
as cross-Camp persistent prompt injection when a Runtime later reads the live Projection. Model
guidance cannot replace Core enforcement, but Projection and Skill semantics must prevent
provisional content from being presented as a user statement, permission or confirmed rule.

## Decision

### Non-overridable Secret Filter

Core continues to apply one deterministic, non-overridable Memory Secret Filter before any
Proposal or Revision body is persisted. It covers Agent add/revise, policy-auto application, user
direct create/revise, user acceptance edits and future import paths.

The filter rejects high-confidence credential material such as passwords, API/access tokens,
private keys and authentication headers. No user, Agent Capability, policy or Scope may override
it. Rejection persists no candidate body, and events, results, receipts, diagnostics, telemetry and
test snapshots contain only stable non-sensitive codes.

v0.13 does not add a model-authored sensitivity score, personality profile, quarantine Lifecycle
or generic `sensitive` Kind. Model classification is not a Core security boundary.

### Ordinary personal context

Ordinary personal context remains legal only when it fits the closed preference/agreement/lesson
Kinds and the selected Scope. Per-item user confirmation remains mandatory except for the exact
provisional Companion Lesson policy in ADR-0053.

Enabling that policy is explicit user preauthorization to persist qualifying ordinary personal
context for one Companion's future Runs. Fresh-install onboarding presents the default-on policy
before the first Tool-enabled AgentRun and records the user's preselected or changed choice; the
setting UI continues to disclose the same behavior. Upgrades default the policy off. The product
must not describe the deterministic Secret Filter as a general personal-data classifier.

### Provisional authority in Agent context

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

### Memory Stewardship Skill v2

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

## Consequences

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

## Rejected Alternatives

- Rely only on the model to classify secrets or sensitive data: nondeterministic output cannot
  enforce persistence safety.
- Present provisional and confirmed entries identically: makes the authority distinction cosmetic.
- Treat provisional Memory as an instruction channel: creates a persistent privilege-escalation
  path across Camps.
- Add a generic personality or observation profile: conflicts with the closed Memory Kind model.
- Put the complete Memory body in the Guide: consumes context and bypasses native on-demand reads.
- Let Skill text grant automatic authority: confuses guidance with Core policy.

## References

- [v0.13 伙伴经验自动沉淀](../versions/v0.13/README.md)
- [ADR-0015: Action and Safety v2](0015-action-safety-v2.md)
- [ADR-0017: Managed Skill Library and Runtime-Native Projection](0017-managed-skill-library-runtime-projection.md)
- [ADR-0024: Closed Memory Kinds](0024-closed-memory-kinds.md)
- [ADR-0027: Memory-Domain Forgetting](0027-memory-domain-forgetting.md)
- [ADR-0039: Memory Proposal Capability](0039-memory-proposal-capability.md)
- [ADR-0042: Fail-Closed Memory Projection](0042-fail-closed-memory-projection.md)
- [ADR-0052: Explicit Memory Revision Authority](0052-explicit-memory-revision-authority.md)
- [ADR-0053: User-Preauthorized Provisional Companion Lessons](0053-user-preauthorized-provisional-companion-lessons.md)
- [Superseded ADR-0043](0043-memory-secret-filter.md)
- [Superseded ADR-0046](0046-memory-stewardship-bundled-skill.md)
