---
document_type: adr
id: ADR-0035
title: "User-Transparent, Agent-Applicable Relationship Memory"
status: accepted
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: [ADR-0023, ADR-0034]
superseded_by: null
---

# ADR-0035: User-Transparent, Agent-Applicable Relationship Memory

## Context

ADR-0023 treated one unordered Relationship pair as fully visible to the user and both
AgentProfiles, even when Direction made a Memory applicable to only one Agent. ADR-0034 filtered
each Agent's default projection by applicability but retained an explicit structured search path
for the reverse direction.

That produces two Agent read models: native reads of an applicability-filtered Markdown directory
and structured SQLite search of the complete pair. Besides adding a second tool and response
format, the search path lets routine Agent use bypass the deliberately narrow file view. The
selected v0.10 behavior is simpler: users govern the complete pair, while Agents receive only the
content that applies to their own behavior through native file reads.

## Decision

Relationship Scope remains an immutable unordered pair of AgentProfiles. The authenticated user
can view, search and govern the complete pair through the Memory management Read Side.

Each Relationship Memory has an immutable Direction:

```text
mutual

directed {
  actorAgentProfileId,
  counterpartyAgentProfileId
}
```

For pair `(A, B)`, `mutual` enters both Agents' supported read views.
`directed(A → B)` enters only A's view when A collaborates with B; it does not enter B's view.
Changing mutual/directed or reversing actor and counterparty creates a new Memory under ADR-0022.

For an AgentRun of A in Camp C, Memory Guide exposes one live Relationship Projection Directory
specific to `(C, A)`, rather than enumerating one file per member. For every other current member
B, the corresponding file contains only active:

```text
mutual(A, B)
directed(A → B)
```

Pairs outside C and `directed(B → A)` are absent. Memory Guide and ContextManifest freeze the
directory root, not child names, child contents or a per-Run snapshot.

v0.10 exposes no `memory.search` or other structured Memory read tool to Agents. Their supported
Memory read surface consists solely of the Hearth file, their own Companion file and their
applicability-filtered Relationship directory, read with Runtime-native filesystem tools. The
complete pair is available only to the user-facing Memory management Read Side.

This boundary does not claim OS-level isolation. As established by ADR-0032, a Runtime process
with broad local filesystem permission may traverse unadvertised userData paths; Lumen neither
advertises that as supported behavior nor treats paths as a Core security sandbox.

Direction may narrow Agent delivery but must not create a user-hidden record. Relationship Memory
still cannot store personality labels, capability scores, behavior dossiers, secrets or temporary
task state.

## Consequences

- Agents have one Memory read mechanism and one applicability model: live projected files.
- A does not spend context on B's one-way obligations and cannot use a Lumen Memory search tool
  to retrieve them.
- The user remains the sole party with a complete, searchable pair view and mediates corrections
  involving content hidden from one Agent's supported read surface.
- A rule intended to guide both Agents must be stored as `mutual`; two directed rules are not
  automatically treated as a shared agreement.
- Memory Guide remains bounded to one Relationship directory root regardless of Camp size.
- The only v0.10 Agent-facing Memory mutation surface can be designed around
  `memory.propose_change`; user lifecycle and management operations stay outside Agent tools.

## Rejected Alternatives

- Keeping `memory.search` for explicit complete-pair inspection: creates a second Agent read
  protocol and bypasses the applicability-filtered projection.
- Giving both Agents the complete pair file: exposes reverse-direction material during routine
  reads and wastes context.
- Listing every collaborator file in Memory Guide: makes prompt metadata grow with Camp size.
- Making Relationship Scope itself directional: duplicates pair identity and conflates ownership
  with Agent delivery.
- Hiding directed content from the user: undermines user governance and creates an unauditable
  Agent dossier.

## References

- [v0.10 长期记忆](../versions/v0.10/README.md)
- [ADR-0019: Application-Global Memory Ownership](0019-application-global-memory-ownership.md)
- [ADR-0022: Immutable Memory Scope](0022-immutable-memory-scope.md)
- [ADR-0032: User-Authorized Live Memory Projection](0032-user-authorized-live-memory-projection.md)
- [Superseded ADR-0023](0023-transparent-relationship-direction.md)
- [Superseded ADR-0034](0034-agent-applicable-relationship-projection.md)
