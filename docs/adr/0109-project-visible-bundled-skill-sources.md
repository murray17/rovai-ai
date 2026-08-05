---
document_type: adr
id: ADR-0109
title: Project-Visible Bundled Skill Sources
status: accepted
date: 2026-08-05
decision_scope: cross-version
source_version: v0.40
supersedes: []
superseded_by: null
---

# ADR-0109: Project-Visible Bundled Skill Sources

## Context

ADR-0105 defined one official Skill and the Runtime-group delivery model, but the complete bundled
content lived below a generic application resource tree. That layout makes product-owned Skill
instructions harder to discover and review as first-class project source. Rovai also needs a
durable Task-scoped Git worktree workflow that can be delivered through the same managed Skill
Library without creating a separate prompt protocol.

Bundled source layout and managed runtime delivery have different roles. Repository files must be
easy to inspect and version, while an AgentRun must continue to receive an immutable managed
SkillRevision selected through an explicit Delivery Group Assignment. Merely placing a directory in
the repository must not bypass enablement, assignment, projection safety, or action authority.

## Decision

Rovai ships exactly two official Skills:

- `rovai-memory-stewardship` (“共同记忆维护”);
- `rovai-worktree` (“隔离 Worktree”).

Official Skill names continue to use the `rovai-` prefix. Both Skills are installed enabled and
without a default Delivery Group Assignment. `rovai-worktree` binds one reusable isolated Git
worktree to a durable Task across AgentRuns; it does not grant implementation, filesystem, Git, or
cleanup authority.

The complete, reviewable source for every official Skill lives at `skills/<skill-name>/` in the
repository. Each directory contains a valid `SKILL.md`, its matching `agents/openai.yaml`, and any
future scripts, references, or assets required by that Skill. Core's bundled manifest embeds these
files from the same directories and publishes them through the existing immutable SkillRevision
installation path.

The repository directory is packaging input, not a Runtime discovery root and not the managed
Library. Runtime delivery continues to follow ADR-0105: explicit application-global Assignment,
safe project-native projection, active-Run stability, same-name shadowing, and frozen exposure
evidence. Adding or removing an official Skill requires updating the bundled manifest, project
source directory, product terminology, and installation/smoke coverage together.

This decision locally replaces only ADR-0105's “single official Skill” clause. Its official-name
prefix and all Library, Assignment, projection, safety, and presentation decisions remain active.

## Consequences

- Reviewers can inspect every bundled Skill directly under one first-class project directory.
- The worktree workflow uses the same user-controlled Runtime delivery mechanism as other Skills.
- Bundled Skill contents remain immutable after installation and cannot silently execute merely
  because their source exists in the repository.
- Source additions now require synchronized Rust manifest and acceptance updates; a directory alone
  is intentionally insufficient to make a Skill official.

## Rejected Alternatives

- Keep official Skills under a generic resource tree: rejected because product Skill content should
  be visible and reviewable as first-class source.
- Discover repository `skills/` directly at Runtime: rejected because it bypasses immutable
  revisions, assignments, projection conflict handling, and exposure evidence.
- Inject the worktree instructions into every prompt: rejected because unsupported or unassigned
  Runtimes must not receive a hidden fallback Skill protocol.
- Drop the `rovai-` prefix: rejected to preserve the official namespace and avoid collisions with
  user-imported generic Skill names.

## References

- [ADR-0105: Runtime-Group Assigned Rovai Skill Delivery](0105-runtime-group-assigned-skill-delivery.md)
- [Skill settings UI contract](../ui/arctic-dawn.md)
- [Domain terminology](../../CONTEXT.md)
