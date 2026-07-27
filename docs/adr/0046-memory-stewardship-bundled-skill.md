---
document_type: adr
id: ADR-0046
title: "Memory Stewardship Bundled Skill"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0054
---

# ADR-0046: Memory Stewardship Bundled Skill

## Context

Long-term Memory needs model-facing guidance for deciding what is durable, reading applicable
projections, avoiding duplicates, choosing scope and direction, filtering secrets, and submitting
a Proposal. These are one stewardship workflow rather than three unrelated workflows for Hearth,
Companion, and Relationship.

Lumen already has an authoritative Skill Library, immutable SkillRevision, project-level
same-name shadowing, Runtime-native SkillProjection, and ContextManifest recording. Creating a
second prompt-distribution mechanism for Memory would duplicate that architecture and make
Runtime behavior diverge.

Guidance must also remain distinct from authority: a Skill can teach an Agent to call a tool but
cannot grant the corresponding business Capability or approve its own Proposal.

## Decision

Ship one Bundled Skill named `memory-stewardship`, displayed as “共同记忆维护”. It is enabled by
default for AgentProfiles whose Runtime supports Skills, and the user may disable it.

The Skill teaches a single bounded workflow:

1. decide whether the candidate is durable rather than transient task state, personality
   assessment, or gamified score;
2. use the current Run's authorized projection paths to read applicable confirmed Memory;
3. avoid exact duplicates and choose the allowed Scope, Kind, and Relationship Direction;
4. write one atomic canonical text without secret credentials;
5. submit add or revise through `memory.propose_change`;
6. treat a successful receipt as a saved pending Proposal, never as effective Memory.

Hearth, Companion, and Relationship do not receive separate Skills. Runtime providers do not
receive semantically separate variants.

Distribution reuses the existing Skill Library, immutable SkillRevision, Runtime-native
SkillProjection, project same-name shadowing, and ContextManifest digest rules. A project Skill
with the same logical name wins according to the existing shadow policy.

Skill enablement and `memory.propose_change` Capability are independent inputs to AgentRun
resolution. The Skill grants no Capability and cannot relax Memory scope, direction, quota,
Secret Filter, CAS, or user-confirmation enforcement.

If a Runtime cannot consume Skills, Lumen exposes that degradation and lets the Run continue.
It does not inject the Skill body into a System Prompt, emulate a hidden Skill channel, inline
Memory bodies, or block the Run solely because this guidance is unavailable.

## Consequences

- One maintained workflow stays consistent across all three Memory scopes.
- Memory guidance inherits existing Skill revisioning, projection, shadowing, and reproducibility.
- Security remains enforced by Gateway and Memory Domain rather than by model compliance.
- Users can disable the stewardship guidance without changing their Memory Library or user
  management authority.
- Unsupported Runtimes may propose less effectively, but the degradation is explicit and does not
  create a second delivery contract.

## Rejected Alternatives

- One Skill per Scope: duplicates judgment and submission guidance while inviting drift.
- One variant per Runtime: makes policy depend on provider-specific prompt packaging.
- Mandatory System Prompt text: bypasses Skill enablement, projection, and shadowing semantics.
- Skill-implied Capability: confuses model guidance with business authorization.
- Hidden fallback prompt or inline Memory: creates an unaudited context-delivery path.
- Blocking unsupported Runtimes: makes optional guidance a hard execution dependency.

## References

- [v0.10 长期记忆](../versions/v0.10/README.md)
- [ADR-0017: Managed Skill Library and Runtime-Native Projection](0017-managed-skill-library-runtime-projection.md)
- [ADR-0032: User-Authorized Live Memory Projection](0032-user-authorized-live-memory-projection.md)
- [ADR-0039: Memory Proposal Capability](0039-memory-proposal-capability.md)
