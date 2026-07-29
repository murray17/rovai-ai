---
document_type: adr
id: ADR-0039
title: "Memory Proposal Capability"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0069
---

# ADR-0039: Memory Proposal Capability

## Context

MemoryProposal is non-authoritative and requires user confirmation, but it is still durable
application-global state that can create user review work. Merely exposing a Team MCP tool to a
Runtime is not a Core authorization boundary under ADR-0014. Lumen therefore needs an explicit
business Capability controlling which AgentRuns may add items to the proposal queue.

The feature should work by default for active Companions without requiring every user to discover
and enable a new setting, while preserving the existing AgentProfile default and CampMember
override mechanisms for users who want a quieter or more restricted Agent.

## Decision

Define one business Capability:

```text
memory.propose_change
```

Every active AgentProfile receives it in the default capability configuration. A user may revoke
it in the AgentProfile default configuration or through a CampMember override. Effective
Capability is materialized and frozen into each AgentRun under the existing collaboration
configuration protocol; configuration changes affect later Runs and do not rewrite the current
Run.

Every `memory.propose_change` invocation must resolve the current Native Binding, AgentRun and
Execution Epoch, then verify the frozen effective configuration contains
`memory.propose_change`. Missing or ambiguous identity, a fenced Run, inactive membership or
missing Capability fails closed before a Proposal is persisted.

Tool discovery, Team MCP injection, Default Lead status, model confidence, repeated observations
and earlier successful calls never substitute for Capability. Capability authorizes only saving
the bounded `add` and `revise` Proposals defined by ADR-0036 and ADR-0037.

It does not authorize accepting a Proposal, creating or selecting a MemoryRevision, changing
Lifecycle, creating Supersession or reading broader Memory state. Authenticated user management
commands do not depend on Agent Capability.

## Consequences

- Long-term Memory proposals work by default for active AgentProfiles.
- Users can disable proposal creation globally for one Companion or within a particular Camp.
- Existing per-Run capability freezing and fail-closed Gateway checks are reused across Adapters.
- Seeing the tool does not imply that a call will be authorized.
- Proposal authority remains strictly weaker than user Memory authority.
- Migration must add the new default Capability without overwriting user-customized capability
  choices.

## Rejected Alternatives

- Treating Tool visibility as permission: violates ADR-0014 and cannot survive Runtime variance.
- Requiring no Capability because Proposals are non-effective: ignores durable queue spam and
  governance cost.
- Defaulting the Capability off: makes the core v0.10 behavior undiscoverable without setup.
- Granting it only to Default Lead: role does not imply Memory judgment or broader authority.
- Letting Capability accept Proposals: would make Agent authority equivalent to the user's.
- Applying Agent Capability to user commands: confuses delegated Agent action with ownership.

## References

- [v0.10 长期记忆](../versions/v0.10/README.md)
- [ADR-0014: Stable Team Tool Gateway v2](0014-stable-team-tool-gateway-v2.md)
- [Superseded ADR-0020](0020-user-authorized-memory-mutation.md)
- [ADR-0053: User-Preauthorized Provisional Companion Lessons](0053-user-preauthorized-provisional-companion-lessons.md)
- [ADR-0036: Agent-Bounded Memory Proposal Scope](0036-agent-bounded-memory-proposal-scope.md)
- [ADR-0037: Actor-Bounded Relationship Proposal Direction](0037-actor-bounded-relationship-proposal-direction.md)
