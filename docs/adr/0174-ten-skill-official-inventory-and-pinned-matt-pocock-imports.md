---
document_type: adr
id: ADR-0174
title: Ten-Skill Official Inventory and Pinned Matt Pocock Imports
status: accepted
date: 2026-08-13
decision_scope: cross-version
source_version: v0.70
supersedes:
  - ADR-0167
superseded_by: null
---

# ADR-0174: Ten-Skill Official Inventory and Pinned Matt Pocock Imports

## Context

ADR-0167 freezes the exact seven-Skill official inventory and requires a successor decision for any
addition. The `mattpocock/skills` repository contains three engineering workflows that are useful in
Rovai without first being redesigned around Camp collaboration: disciplined bug diagnosis, explicit
test-driven development, and writing instructions for coding agents.

A floating GitHub reference or runtime-time download would make the application package
non-reproducible. Importing the upstream trigger descriptions unchanged would also make the Skills
too eager: diagnosis could be mistaken for fix authority, TDD could trigger for ordinary test work,
and agent-instruction writing could absorb normal user documentation.

## Decision

1. Rovai releases exactly ten official Skills: `analyze-agent-codebase`, `cli-operations`,
   `diagnosing-bugs`, `grill-duo`, `grill-duo-with-docs`, `memory-stewardship`, `tasteful-ui`, `tdd`,
   `worktree`, and `writing-for-agents`.
2. `diagnosing-bugs`, `tdd`, and `writing-for-agents` are pinned GitHub-origin official Skills from
   `https://github.com/mattpocock/skills` at revision
   `84fdeffd12f2ee307994d1eb6feb48173b6e0502`. Rovai vendors every file in the selected upstream
   directories and adds the repository MIT `LICENSE` plus a per-Skill `NOTICE` recording repository,
   revision, and source directory.
3. Rovai may narrow only each imported `SKILL.md` front-matter description and localize
   `agents/openai.yaml`. The remaining `SKILL.md` body and all other selected upstream resources are
   retained unchanged. The resulting bundled manifests contain 5 files for `diagnosing-bugs`, 6 for
   `tdd`, and 5 for `writing-for-agents`.
4. Trigger boundaries are explicit:
   - `diagnosing-bugs` is for an explicit diagnosis, root-cause investigation, regression, hard or
     intermittent bug, or a failed earlier fix. A diagnosis-only request does not authorize a fix.
   - `tdd` is for explicit TDD, test-first, red-green-refactor, or an agreed failing-test-first feature
     or fix. Merely adding or updating tests does not trigger it.
   - `writing-for-agents` is for Skills and other documents consumed as coding-agent instructions,
     including invocation wording, progressive disclosure, and completion criteria. It does not own
     ordinary user documentation, product copy, or code comments.
5. The three additions use the ordinary official Skill Library lifecycle: immutable bundled
   Revisions, default enabled state, default assignment to all nine Runtime Groups, user-controlled
   later enablement and Assignment, official-name collision protection, and GitHub provenance shown
   only as source metadata. They receive no required/locked state or special delivery protocol.
6. Build and runtime installation remain offline. None follows a branch or checks GitHub for
   updates. A future refresh must select an exact commit, re-vendor all selected source directories,
   re-check license and notices, and validate the full bundled manifests.
7. All constraints inherited from ADR-0167 remain in force, including the pinned
   `tasteful-ui` snapshot. No Skill grants filesystem, Git, network, Tool, collaboration, approval,
   diagnosis, test-seam, documentation, or implementation authority beyond the current request and
   Runtime permissions.
8. Any future official inventory change requires another successor ADR plus coordinated Core
   manifest, terminology, source presentation, smoke, and acceptance fixture changes.

This decision completely supersedes ADR-0167. ADR-0158 continues to own the default-all Runtime
Group policy, while ADR-0166 continues to own progressive CLI teaching.

## Consequences

- Core, Renderer, documentation, and acceptance fixtures share one exact ten-item inventory.
- The three imported workflows are reproducible, auditable, and visibly GitHub-origin without
  requiring network access during build, install, or execution.
- Narrow descriptions reduce accidental invocation while preserving the upstream workflow bodies.
- `diagnosing-bugs` adds one non-executable shell template that remains visible in the Skill risk
  summary; the other two additions contain documentation only.
- Updating the shared upstream revision changes all three immutable snapshots together unless a
  later ADR explicitly splits their provenance.

## Rejected Alternatives

- **Import the entire `mattpocock/skills` repository.** Rejected because most Skills have not been
  evaluated against Rovai terminology, authority, delivery, and Camp collaboration boundaries.
- **Track `main` or download during build/runtime.** Rejected because the released content, license
  evidence, offline behavior, and immutable Revision could no longer be reproduced.
- **Keep the broad upstream descriptions unchanged.** Rejected because metadata is the invocation
  boundary and would create predictable false-positive triggers.
- **Rewrite the three workflow bodies into Rovai-native variants now.** Rejected because the chosen
  workflows are already self-contained; provenance-preserving adaptation is smaller and easier to
  audit.
- **Import upstream `code-review` unchanged.** Rejected for now because its Standards/Spec parallel
  reviewer pattern should be redesigned around Rovai's public asynchronous A2A Messages, fixed Camp
  partners, solo fallback, and explicit authority boundary rather than silently treating generic
  subagents as Rovai teammates.

## References

- [v0.70 current version](../versions/v0.70/README.md)
- [ADR-0158: Default-All Runtime Delivery for Managed Skills](0158-default-all-runtime-delivery-for-managed-skills.md)
- [ADR-0166: Progressive Built-In CLI Teaching](0166-progressive-built-in-cli-teaching.md)
- [ADR-0167: Seven-Skill Official Inventory (historical)](0167-seven-skill-official-inventory.md)
- [`diagnosing-bugs` bundled source](../../skills/diagnosing-bugs/SKILL.md)
- [`tdd` bundled source](../../skills/tdd/SKILL.md)
- [`writing-for-agents` bundled source](../../skills/writing-for-agents/SKILL.md)
- [Domain terminology](../../CONTEXT.md)
