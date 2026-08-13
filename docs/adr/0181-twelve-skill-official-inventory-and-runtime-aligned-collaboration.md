---
document_type: adr
id: ADR-0181
title: Twelve-Skill Official Inventory and Runtime-Aligned Collaboration
status: accepted
date: 2026-08-14
decision_scope: cross-version
source_version: v0.74
supersedes:
  - ADR-0176
intended_supersedes: []
superseded_by: null
---

# ADR-0181: Twelve-Skill Official Inventory and Runtime-Aligned Collaboration

## Context

ADR-0176 freezes eleven official Skills, adds Campfire and makes `cli-operations` and
`memory-stewardship` system-required. Rovai now needs a Camp-native code review workflow in which
two real members independently review the same frozen change along Standards and Spec axes.

The collaboration Skills must also match the public A2A contract already shipped by Core. An Agent
can choose explicit recipients, but cannot choose an arbitrary reply target: Core always links a new
Agent-authored CampMessage to the current AgentRun trigger. Natural headings can help discovery and
reading, but cannot authenticate a sender or create a workflow relation. A Skill design that draws a
different message tree would be non-executable even if its Markdown appears coherent.

## Decision

1. Rovai releases exactly twelve official Skills: `analyze-agent-codebase`, `campfire`,
   `cli-operations`, `diagnosing-bugs`, `grill-duo`, `grill-duo-with-docs`,
   `memory-stewardship`, `review-duo`, `tasteful-ui`, `tdd`, `worktree`, and
   `writing-for-agents`.
2. `cli-operations` and `memory-stewardship` retain the `system_required` management policy. Core
   keeps both enabled and assigned to all Runtime Groups, rejects supported configuration mutation,
   repairs legacy drift, and omits them from Renderer Skill Settings. The other ten official Skills
   use ordinary `user_managed` delivery and appear in Settings.
3. `review-duo` is original Rovai work with eleven bundled files, no external upstream, and a NOTICE
   recording principle-level inspiration from Matt Pocock's MIT-licensed code-review Skill. It
   triggers implicitly only for explicit two-member, dual-axis or team review intent; ordinary solo
   code review remains outside its automatic trigger.
4. Campfire, both Grill Duo Skills and Review Duo use Runtime-provided trusted sender identity,
   explicit Agent recipients and Core-managed reply-to-current-trigger relations. Natural headings
   are discovery and presentation clues, never authentication, correlation, idempotency or workflow
   state. These Skills introduce no workflow/session/stage/attempt/message-kind fields or persisted
   orchestration object.
5. Review Duo preserves one Standards reviewer and one Spec reviewer, locks and reports both axes
   independently, and uses the executable causal chain: Lead initial messages share the current user
   trigger; the partner result directly replies to its Standards request; the final report replies
   to the partner result that triggers Lead continuation. A human-readable launch message is not an
   Agent-selectable reply root.
6. Skill-only Review Duo v1 admits a complete duo only for an immutable Git-object-backed range that
   both members can resolve, or an immutable patch/attachment already supplied through a stable
   shared locator. A dirty worktree without such an artifact must use explicit input stabilization,
   visible solo fallback or termination; the Skill cannot claim a snapshot distribution capability
   that Runtime does not provide.
7. ADR-0174's pinned GitHub provenance, exact vendored manifests, offline installation, narrowed
   triggers, collision protection and authority limits remain in force for the four GitHub-origin
   official Skills. A Skill never grants authority beyond the current request and Runtime
   permissions.
8. Any future official inventory or management-policy change requires another successor ADR plus
   coordinated bundled source, Core, Renderer, documentation, smoke and acceptance updates.

This decision completely supersedes ADR-0176. ADR-0158 continues to own default-all delivery for
newly installed user-managed Skills, ADR-0163 continues to own caller return and Core-managed reply
references, and ADR-0166 continues to own progressive CLI teaching.

## Consequences

- Core and native Runtime discovery contain twelve official Skills, while Settings intentionally
  presents ten configurable official Skills.
- Review Duo is reproducible and Camp-native without turning public headings into protocol fields or
  making ordinary code review unexpectedly require a partner.
- Public message trees follow actual AgentRun causality. The launch marker cannot be used as an
  arbitrary parent, so final reports appear under the partner result that resumed the Lead.
- Dirty-worktree duo review is intentionally narrower until a contracted shared immutable snapshot
  mechanism exists.
- The two operational Skills remain continuously delivered and absent from the configuration UI;
  all other official Skills remain legitimate user choices.

## Rejected Alternatives

- **Keep Review Duo as a user Imported Skill.** Rejected because Camp-native two-axis review is a
  product workflow that needs deterministic offline bundling, default Runtime delivery and the same
  provenance/acceptance governance as other official collaboration Skills.
- **Trigger Review Duo for every code review.** Rejected because it would hijack ordinary solo review
  and fail or degrade unexpectedly when no eligible Camp partner exists.
- **Pretend launch is the reply root.** Rejected because `rovai send` exposes no reply target and Core
  links every send to the current AgentRun trigger. A decorative tree must not be specified as an
  executable invariant.
- **Add workflow/session/stage fields or a review state machine.** Rejected because trusted sender,
  explicit Delivery, direct reply closure, frozen input identifiers and one-active-workflow bounds
  are sufficient for these Skill-only flows.
- **Have Review Duo create a shared dirty-worktree snapshot implicitly.** Rejected because current
  send/attachment contracts do not provide that distribution action, and review-only authority does
  not permit silently writing or committing the workspace.
- **Make all twelve official Skills system-required.** Rejected because ten are optional user
  workflows whose enablement and Runtime delivery remain legitimate preferences.

## References

- [v0.74 current version](../versions/v0.74/README.md)
- [ADR-0158: Default-All Runtime Delivery for Managed Skills](0158-default-all-runtime-delivery-for-managed-skills.md)
- [ADR-0163: Explicit Caller Return and Core-Managed Reply Reference](0163-explicit-caller-return-and-core-managed-reply-reference.md)
- [ADR-0166: Progressive Built-In CLI Teaching](0166-progressive-built-in-cli-teaching.md)
- [ADR-0176: Eleven-Skill Official Inventory (historical)](0176-eleven-skill-official-inventory-and-system-required-operations.md)
- [Camp Message Send v5](../contracts/camp-message-send-v5.md)
- [Message Delivery v2](../contracts/message-delivery-v2.md)
- [Context Delivery Profile v3](../contracts/context-delivery-profile-v3.md)
- [`review-duo` bundled source](../../skills/review-duo/SKILL.md)
- [Built-in Tool Runtime](../architecture/builtin-tool-runtime.md)
