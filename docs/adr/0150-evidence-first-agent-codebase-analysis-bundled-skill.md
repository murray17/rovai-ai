---
document_type: adr
id: ADR-0150
title: Evidence-First Agent Codebase Analysis Bundled Skill
status: superseded
date: 2026-08-10
decision_scope: cross-version
source_version: v0.52
supersedes:
  - ADR-0144
superseded_by: ADR-0159
---

# ADR-0150: Evidence-First Agent Codebase Analysis Bundled Skill

## Context

Rovai's four official Skills cover memory stewardship, Task-scoped worktrees, and two self-contained duo grilling
workflows. Repeated analysis of Coding Agent and multi-Agent repositories also needs a stable product-owned method:
trace real entrypoints and state transitions, distinguish implementation facts from design claims, classify planning,
delegation, Memory, Tool, Skill, storage, middleware, permission, and recovery boundaries, and produce evidence-linked
reports without turning keyword matches into architecture conclusions.

A generic prompt is insufficient because the recurring failure is methodological rather than repository-specific.
Publishing an analysis Skill as an external dependency would also make the workflow unavailable unless users discover,
import, enable, and assign the same third-party content. The workflow must remain portable across repositories and Agent
Runtimes without granting filesystem, documentation, collaboration, or execution authority.

## Decision

Rovai ships five official Skills:

- `analyze-agent-codebase` (“Agent 代码库分析”);
- `memory-stewardship` (“共同记忆维护”);
- `worktree` (“隔离 Worktree”);
- `grill-duo` (“双人追问”);
- `grill-duo-with-docs` (“双人追问与文档”).

Every official Skill is installed enabled and without a default Skill Group Assignment. Official identity is carried
by `origin = official`, immutable bundled source, and UI provenance rather than a product prefix in the Skill name.
Availability and assignment never grant filesystem, Git, documentation, collaboration, Tool, permission, approval,
or implementation authority.

The prefix removal is a current-only name cutover. Core strips the exact former prefix from existing official records
before publishing the current bundled Revision, preserving the official Skill ID and saved Assignments for local
development data. There is no alias, dual publication, fallback lookup, or imported-name conflict migration; prompts,
project-native directory names, manifests, and new API results use only the unprefixed names.

The complete source of every official Skill lives under `skills/<skill-name>/` and contains `SKILL.md`, matching
`agents/openai.yaml`, and every required reference. Core embeds that exact file manifest and installs it through the
immutable SkillRevision path. Repository source is packaging input, not a Runtime discovery root. Adding or removing
an official Skill requires synchronized source, Core manifest, terminology, UI copy, and smoke/acceptance updates.

`analyze-agent-codebase` is self-contained and evidence-first:

- analysis requests are read-only unless the user explicitly requests document output;
- repository instructions are followed first, while executable source, assembly, state/schema, and tests remain the
  implementation evidence used to verify explanatory documentation;
- high-level conclusions are marked `confirmed`, `inferred`, or `unknown` and cite source paths, symbols, and the
  relevant entry-to-effect call chain;
- architecture labels such as ReAct, Plan-and-Execute, sub-Agent, Memory, Tool, Skill, or middleware require behavioral
  evidence and cannot be inferred from names alone;
- full dossiers use one index plus only the applicable topic documents, while targeted questions trace only the needed
  vertical slice;
- optional Camp collaboration may split bounded evidence collection, but one primary analyst reconciles cross-domain
  conclusions, verifies returned evidence, and never treats `rovai send` acceptance as teammate completion.

The two duo Skills retain ADR-0144's self-contained content and asynchronous public A2A protocol: each works when
assigned alone, embeds the instructions needed by its partner, asks one user question at a time, does not include the
questioner's recommendation in the partner request, and neither polls nor invents a second opinion. Their generic
design inputs remain non-bundled and are not Runtime dependencies.

ADR-0105 continues to own enablement, assignment, projection, conflict, and exposure semantics, except that this ADR
replaces its `rovai-` official-name prefix rule. This ADR completely replaces ADR-0144 by retaining those duo and
project-visible packaging decisions while extending the official set and freezing the codebase-analysis workflow
boundary.

## Consequences

Users can assign a consistent repository-archaeology workflow to any supported Runtime without importing an external
Skill. Reports become reviewable because conclusions preserve source evidence, inference status, counter-evidence, and
unknowns. The workflow remains useful in a single-member Camp; optional collaboration improves evidence collection but
does not change result authority or asynchronous delivery semantics.

Core and UI acceptance fixtures must now expect five official Skills. The bundled reference adds immutable package
content but no executable script, Tool dependency, prompt fallback, automatic assignment, or new Runtime Capability.
Future changes to the official set must supersede this exact inventory rather than edit an accepted decision in place.
Removing the prefix changes explicit invocation and project-native projection paths in one cutover.

## Rejected Alternatives

- Keep the workflow as a long prompt or Memory: rejected because it is a reusable operational method with supporting
  reference material, not a stable user preference or project fact.
- Keep the `rovai-` prefix on official names: rejected because `origin`, immutable bundled source, and UI provenance
  already distinguish official Skills, while the prefix adds noise to invocation and project-native directory names.
- Trust repository documentation as the primary analysis authority: rejected because the workflow exists to detect
  implementation drift and must trace executable behavior independently.
- Require multiple Camp members: rejected because analysis must remain available in a single-member Camp and public A2A
  delivery is asynchronous.
- Bundle a crawler or language-specific parser: rejected because repository languages and registration patterns vary,
  while the high-value reusable part is evidence judgment and vertical tracing rather than one mechanical scan.

## References

- [v0.52 overview](../versions/v0.52/README.md)
- [ADR-0105: Runtime-Group Assigned Rovai Skill Delivery](0105-runtime-group-assigned-skill-delivery.md)
- [ADR-0144: Self-Contained Duo Grilling Bundled Skills](0144-self-contained-duo-grilling-bundled-skills.md)
- [Skill settings UI contract](../ui/arctic-dawn.md)
- [Domain terminology](../../CONTEXT.md)
- [`analyze-agent-codebase` source](../../skills/analyze-agent-codebase/SKILL.md)
