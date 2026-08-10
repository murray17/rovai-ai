---
document_type: adr
id: ADR-0144
title: Self-Contained Duo Grilling Bundled Skills
status: superseded
date: 2026-08-09
decision_scope: cross-version
source_version: v0.49
supersedes:
  - ADR-0109
superseded_by: ADR-0150
---

# ADR-0144: Self-Contained Duo Grilling Bundled Skills

## Context

Rovai's official Skill sources are project-visible packaging inputs whose immutable revisions are delivered through
explicit Runtime-group assignments. The existing official set covers memory stewardship and Task-scoped worktrees,
but it does not provide a product-owned workflow for stress-testing a plan with a second Camp member.

The proposed duo workflows were derived from `grill-me`, `grill-with-docs`, `grilling`, and `domain-modeling`.
Publishing those generic Skills as independent runtime dependencies would couple success to multiple enablement and
assignment choices. A Runtime could receive the duo entry without one of its dependencies, and generic names would
unnecessarily occupy the official namespace. Camp collaboration is also asynchronous: `camp.message.send` creates a
public Message and recipient Delivery, not a synchronous response or automatic closure.

## Decision

Rovai ships four official Skills:

- `rovai-memory-stewardship` (“共同记忆维护”);
- `rovai-worktree` (“隔离 Worktree”);
- `rovai-grill-duo` (“双人追问”);
- `rovai-grill-duo-with-docs` (“双人追问与文档”).

Every official Skill remains installed enabled and without a default Skill Group Assignment. Official names retain
the `rovai-` prefix, and availability never grants filesystem, Git, documentation, collaboration, or implementation
authority.

The complete source of every official Skill remains under `skills/<skill-name>/`, with `SKILL.md`, matching
`agents/openai.yaml`, and all required references. Core embeds that exact manifest and publishes it through the
existing immutable SkillRevision installation path. Repository source is not a Runtime discovery root.

Both duo Skills are runtime-self-contained:

- `rovai-grill-duo` embeds the full one-question-at-a-time grilling procedure and fixed-partner workflow;
- `rovai-grill-duo-with-docs` carries its own duo protocol, domain-modeling discipline, glossary format, and ADR
  judgment reference;
- `grill-me`, `grill-with-docs`, `grilling`, and `domain-modeling` remain design inputs, not official runtime
  dependencies and not separately bundled Rovai Skills.

For each decision point, the current member sends one explicit public A2A request to the fixed partner without
including its own recommendation. The request contains enough instructions for a partner that does not have the duo
Skill assigned. The partner explicitly replies to the questioner with plain-language trade-offs and an independent
recommendation; the questioner then asks the user exactly one question. Neither Skill treats send acceptance as
completion, polls for a response, invents a second opinion, or assumes a protocol-level reply obligation. When no
eligible partner exists, the Skill discloses a single-member fallback.

This ADR replaces ADR-0109 while retaining its project-visible source, synchronized manifest/test updates, and safe
managed-delivery rules. ADR-0105 continues to own enablement, assignment, projection, conflict, and exposure semantics.

## Consequences

- Either duo variant works when assigned alone; users do not need to discover or align hidden dependency assignments.
- Documentation behavior remains portable because repository-specific documentation rules override bundled defaults.
- The async public collaboration chain is visible and auditable, but the second opinion can require multiple AgentRuns.
- Shared duo instructions are intentionally duplicated between immutable Skill revisions and must be kept aligned by
  source review and bundled installation tests.
- Adding or removing an official Skill still requires synchronized source, Core manifest, terminology, UI copy, and
  smoke/acceptance updates.

## Rejected Alternatives

- Bundle every generic dependency: rejected because it expands the official namespace and still requires coordinated
  Runtime-group assignments.
- Let `rovai-grill-duo-with-docs` invoke the other duo Skill by name: rejected because assigning only the documentation
  variant would leave a runtime dependency missing.
- Inject duo instructions into every AgentRun prompt: rejected because it bypasses user-controlled Skill assignment and
  native progressive discovery.
- Treat `rovai send` success as a synchronous teammate result: rejected because Message Delivery owns asynchronous
  dispatch and the success projection does not prove work started or completed.

## References

- [ADR-0105: Runtime-Group Assigned Rovai Skill Delivery](0105-runtime-group-assigned-skill-delivery.md)
- [ADR-0130: Public A2A Messages and Unified Message Delivery](0130-public-a2a-message-and-unified-delivery.md)
- [Camp Message Send v2](../contracts/camp-message-send-v2.md)
- [v0.49 overview](../versions/v0.49/README.md)
- [Skill settings UI contract](../ui/arctic-dawn.md)
- [Domain terminology](../../CONTEXT.md)
