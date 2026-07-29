---
document_type: adr
id: ADR-0036
title: "Agent-Bounded Memory Proposal Scope"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0069
---

# ADR-0036: Agent-Bounded Memory Proposal Scope

## Context

Memory Library is application-global, while an Agent acts through one current fenced AgentRun in
one Camp. User confirmation prevents a Proposal from becoming effective automatically, but it
does not justify letting an Agent create durable suggestions about unrelated Companions or
relationships it is not currently participating in. Such Proposals would pollute the user's
governance queue and let guessed application-level IDs cross the collaboration boundary.

At the same time, limiting every Agent to its own Companion scope would prevent useful Hearth
suggestions and collaboration lessons involving another current Camp member.

## Decision

For a current AgentProfile A acting through a fenced AgentRun in Camp C,
`memory.propose_change` may target only:

```text
hearth
companion(A)
relationship(A, B)  where B is another current CampMember of C
```

This boundary applies to both `add` and `revise`. A revise Proposal has the additional
requirements that the target active Memory is present in A's supported Projection and that the
request carries its exact `memoryId + baseRevisionId`.

An Agent cannot target Companion(B), Relationship(B, D), a Relationship pair outside the source
Camp, or a reverse-directed Memory omitted from A's applicability view. Guessing a Memory ID does
not expand this boundary.

Gateway derives A, Camp C, AgentRun and Execution Epoch from the Native Binding and current run
resolution. It validates current Camp membership and fencing while handling the command; these
identity facts are not model-supplied parameters. Losing a required membership or current Epoch
causes the Proposal request to fail without persistence.

This restriction applies only to Agent Proposals. An authenticated user can directly govern every
legal Scope in the application-global Memory Library through user management commands.

This ADR does not decide which Relationship Directions an `add` Proposal by A may request within
an otherwise valid pair; v0.10 protocol must resolve that separately.

## Consequences

- An Agent can suggest home-wide principles, its own user partnership memories and collaboration
  memories involving a current peer.
- Agents cannot create durable governance noise about unrelated AgentProfiles or Camps.
- Revise authorization matches the material Lumen intentionally exposes to the Agent.
- Gateway needs transactional membership, Run/Epoch and target-Scope validation in addition to
  Capability and schema validation.
- User management remains broader than Agent Proposal authority.

## Rejected Alternatives

- Letting any Agent propose against the whole application Memory Library: permits unrelated and
  guessed-ID targets.
- Limiting A to Companion(A): blocks valid Hearth and current-collaborator lessons.
- Allowing any Relationship pair containing A across all Camps: makes the current Camp boundary
  irrelevant and permits unsolicited cross-context proposals.
- Trusting proposer, Camp or membership IDs from model arguments: bypasses Native Binding and
  fencing guarantees.
- Applying the same restriction to the user: confuses Agent proposal safety with user ownership.

## References

- [v0.10 长期记忆](../versions/v0.10/README.md)
- [ADR-0014: Stable Team Tool Gateway v2](0014-stable-team-tool-gateway-v2.md)
- [ADR-0019: Application-Global Memory Ownership](0019-application-global-memory-ownership.md)
- [ADR-0053: User-Preauthorized Provisional Companion Lessons](0053-user-preauthorized-provisional-companion-lessons.md)
- [ADR-0035: User-Transparent, Agent-Applicable Relationship Memory](0035-user-transparent-agent-applicable-relationship-memory.md)
