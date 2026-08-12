---
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
---

# ADR-0159: Pinned Third-Party Tasteful UI Bundled Skill

## Context

Rovai's five official Skills cover memory stewardship, Task-scoped worktrees, self-contained duo clarification, and
evidence-first Agent repository analysis. Meaningful Renderer and web UI work also repeatedly needs a disciplined way
to understand product context, explore taste before selecting references, turn a chosen direction into executable
design rules, and verify whether the result is actually better rather than merely more stylized.

The upstream `tasteful-ui` Skill already packages that workflow and its reference catalog under an MIT license. Leaving
it as an optional user import makes the workflow dependent on external discovery and mutable branch state. Copying only
its router would also produce broken progressive-disclosure links and remove the concrete design references that make
the Skill useful. Rovai therefore needs an auditable, immutable third-party source boundary rather than a floating
network dependency or a partial transcription.

## Decision

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

## Consequences

Users receive the full Tasteful UI workflow without a separate import and can assign or disable it through the same
managed Skill Library controls as every other official Skill. Reviewers can reproduce the exact upstream content,
license, file manifest, digest, and application release that produced an installed Revision. Offline application
startup remains deterministic because neither build nor install fetches the network.

The bundled binary and source repository grow by roughly 1.3 MB and 84 files. Core and UI fixtures must expect six
official Skills, and Rust compilation now regenerates one deterministic manifest when the vendored directory changes.
Upstream improvements and security fixes are not automatic; maintainers must review and pin them explicitly.

## Rejected Alternatives

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

## References

- [v0.58 overview](../versions/v0.58/README.md)
- [ADR-0105: Runtime-Group Assigned Rovai Skill Delivery](0105-runtime-group-assigned-skill-delivery.md)
- [ADR-0150: Evidence-First Agent Codebase Analysis Bundled Skill](0150-evidence-first-agent-codebase-analysis-bundled-skill.md)
- [ADR-0158: Default-All Runtime Delivery for Managed Skills](0158-default-all-runtime-delivery-for-managed-skills.md)
- [Skill settings UI contract](../ui/arctic-dawn.md)
- [Domain terminology](../../CONTEXT.md)
- [`tasteful-ui` source](../../skills/tasteful-ui/SKILL.md)
- [Pinned upstream repository](https://github.com/DonkeyKing01/tasteful-ui-skill/tree/159ccd47a320f3a7bd0289d07366d422211895a1/tasteful-ui)
