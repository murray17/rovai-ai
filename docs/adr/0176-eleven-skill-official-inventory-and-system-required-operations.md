---
document_type: adr
id: ADR-0176
title: Eleven-Skill Official Inventory and System-Required Operations
status: accepted
date: 2026-08-13
decision_scope: cross-version
source_version: v0.71
supersedes:
  - ADR-0174
superseded_by: null
---

# ADR-0176: Eleven-Skill Official Inventory and System-Required Operations

## Context

ADR-0174 freezes ten official Skills and treats all of them as ordinary user-configurable Library
entries. Rovai now needs one project-native Camp collaboration workflow: a Default Lead invites a
small set of members to form independent opening views, directs only the exchanges that can change
the conclusion, and publishes one terminal summary.

Two existing Skills also carry product-wide operational responsibilities rather than optional user
workflows. `cli-operations` teaches safe use of the built-in CLI, while `memory-stewardship`
preserves Memory authority and mutation boundaries. Allowing either to be disabled or removed from
a Runtime Group can silently remove required guidance; presenting them as ordinary Settings rows
also suggests that such a configuration is supported.

## Decision

1. Rovai releases exactly eleven official Skills: `analyze-agent-codebase`, `campfire`,
   `cli-operations`, `diagnosing-bugs`, `grill-duo`, `grill-duo-with-docs`,
   `memory-stewardship`, `tasteful-ui`, `tdd`, `worktree`, and `writing-for-agents`.
2. `campfire` is original Rovai work with six bundled files and no external upstream. Its
   Skill-only v1 uses ordinary public Camp Messages and trusted Runtime-provided sender identity;
   it introduces no new message kind, persisted discussion object, or Core orchestration state.
3. Campfire is bounded to 2–3 participants, independent opening views, zero to two directed
   responses, and at most one clarification initiated by Campfire. One Default Lead actively
   advances at most one unfinished Campfire per Camp. A shared invitation is the default, including
   when it contains a per-member perspective assignment.
4. The natural headings for invitation, opening view, directed response, and clarification may
   continue a discussion. `### 篝火纪要` is the terminal marker and never a trigger. A completed
   discussion is not reopened by a late reply; publishing the summary does not create a Task, write
   Memory or an ADR, approve implementation, or start implementation.
5. `cli-operations` and `memory-stewardship` have the `system_required` management policy. Core keeps
   both enabled and assigned to all nine Runtime Groups, rejects enablement or Assignment mutation
   commands for them, and repairs legacy configuration drift during bundled installation. They are
   omitted from the Renderer Skill Settings list and have no toggle, Assignment, or locked-state row
   there; they remain official Runtime-delivered Skills and remain available to native discovery.
6. The other nine official Skills, including `campfire`, retain the `user_managed` policy: they are
   enabled and assigned to all Runtime Groups when first installed, then may be configured through
   the ordinary Skill Library controls.
7. ADR-0174's pinned GitHub provenance, exact vendored manifests, offline installation, narrowed
   trigger descriptions, `tasteful-ui` snapshot, collision protection, and authority limits remain
   in force. A Skill never grants authority beyond the current request and Runtime permissions.
8. Any future official inventory or management-policy change requires another successor ADR plus
   coordinated Core contract, bundled source, Renderer, documentation, smoke, and acceptance
   updates.

This decision completely supersedes ADR-0174. ADR-0158 continues to own default-all delivery for
newly installed user-managed Skills; this decision strengthens that policy into a continuously
enforced invariant only for the two system-required Skills. ADR-0166 continues to own progressive
CLI teaching.

## Consequences

- Core and native Runtime discovery contain eleven official Skills, while Settings intentionally
  presents nine configurable official Skills.
- Required CLI and Memory guidance cannot disappear through supported configuration commands, and
  startup repairs unsupported legacy drift without adding a database column.
- Campfire can ship and evolve as inspectable Skill content without coupling its phases to a new
  Core protocol or pretending that public messages provide strict blind review.
- Natural public headings stay understandable to users and avoid leaking internal protocol tags;
  the terminal summary cannot accidentally re-trigger the workflow.
- Existing pinned GitHub Skills remain reproducible and offline.

## Rejected Alternatives

- **Hide the two operational Skills only in Renderer.** Rejected because older clients, direct
  commands, or existing database drift could still disable required delivery.
- **Show disabled controls or a required badge.** Rejected because the Settings surface is for
  supported choices; a non-choice row adds noise and implies a configuration path that does not
  exist.
- **Make every official Skill system-required.** Rejected because the remaining Skills are optional
  user workflows whose enablement and Runtime delivery are legitimate preferences.
- **Add Campfire message kinds or a persisted discussion state machine.** Rejected for v1 because
  bounded public A2A Messages and Skill instructions already express the workflow; Core state can be
  reconsidered only if observed failures require it.
- **Use bracketed phase tags or `$campfire` in public bodies.** Rejected because natural headings are
  sufficient for participants and do not expose invocation mechanics in the conversation.

## References

- [v0.71 current version](../versions/v0.71/README.md)
- [ADR-0158: Default-All Runtime Delivery for Managed Skills](0158-default-all-runtime-delivery-for-managed-skills.md)
- [ADR-0166: Progressive Built-In CLI Teaching](0166-progressive-built-in-cli-teaching.md)
- [ADR-0174: Ten-Skill Official Inventory (historical)](0174-ten-skill-official-inventory-and-pinned-matt-pocock-imports.md)
- [`campfire` bundled source](../../skills/campfire/SKILL.md)
- [Built-in Tool Runtime](../architecture/builtin-tool-runtime.md)
- [Skill Projection Reconciliation](../architecture/skill-projection-reconciliation.md)
