---
document_type: adr
id: ADR-0145
title: Sole Native-Session Self Identity and Peer Routing Projection
status: accepted
date: 2026-08-09
decision_scope: cross-version
source_version: v0.50
supersedes: []
superseded_by: null
---

# ADR-0145: Sole Native-Session Self Identity and Peer Routing Projection

## Context

ADR-0100 moved the current Agent's complete six-field identity from every AgentRun Dynamic Context into
`MEMBER_IDENTITY` at eligible Native Session Bootstrap boundaries. ADR-0129 later made
`COLLABORATION_STATE` a stable team directory, but the projection still included the current Agent's Name, Team
Role and Professional Responsibilities.

Those two lifecycles can diverge deliberately. An AgentProfile identity edit does not rewrite an already delivered
Bootstrap, while the next Dynamic Context may be materialized immediately from current Camp members. The model can
therefore receive an old complete `MEMBER_IDENTITY` and a new three-field self projection in
`COLLABORATION_STATE`. That is a partial self-identity update with no atomic six-field boundary.

The existing collaboration digest is also computed from a broader internal Member State. Presence and other
internal changes can trigger a new section even when model-visible bytes are identical, while a digest copied from
an older contract cannot mean “complete Collaboration State v2 projection”.

## Decision

### `MEMBER_IDENTITY` is the sole self identity

`MEMBER_IDENTITY` is the sole self-identity projection for one Native Session. It remains the complete schema-v1
aggregate in this fixed field order:

```text
name
teamRole
professionalResponsibilities
personalityTraits
workingPrinciples
growthTopic
```

Core reads the latest committed six fields atomically only at an existing eligible Bootstrap delivery boundary.
An identity edit does not patch AgentRun Dynamic Context, create an identity update section, advance a collaboration
watermark, or rotate a Native Session. New Session, existing Resume Bootstrap paths and qualified compaction
redelivery retain their existing delivery matrix.

The complete identity is not persisted as a Blob, snapshot, digest, revision or historical projection. Stable
Bootstrap Evidence continues to exclude identity-bearing bytes.

### `COLLABORATION_STATE` is peer routing identity

`COLLABORATION_STATE` schema v2 contains only peers. Its member set is:

```text
stable current CampMembers - snapshot.agent_id
```

A current CampMember has `CampMember.status = active` and a non-removed AgentProfile. Presence does not select the
directory: `away` remains projected. A leave request also does not end the relationship, so a leave-requested member
remains a peer until `CampMember.status = left`. Core revalidates current membership, Presence, Runtime readiness,
Capability, quota, lineage and fencing when a real send or execution is admitted.

Each peer contains only:

```text
agentId
name
teamRole
professionalResponsibilities
```

Personality Traits, Working Principles and Growth Topic never enter peer routing identity. Presence, leave-request
state, busy state, Runtime state, Capability and current-Turn participation are also absent.

Default Lead is a reference, not a second identity projection:

```text
defaultLeadAgentId: AgentId | null
selfIsDefaultLead: boolean
```

When a peer is Lead, its ID resolves against `peers`. When self is Lead, the ID is still present and the Boolean is
true, but no self Name, Team Role or Responsibilities are repeated. No Lead yields `null` and `false`.

### Digest and inclusion are separate evidence

`collaboration_state_digest` is always the canonical JSON digest of the complete final schema-v2 model projection
after self filtering, privacy filtering, stable ordering and Lead derivation. It is never a digest of the internal
CampMember rows, a rendered fragment or only the fields included in one prompt.

`collaborationStateIncluded` independently records whether `[COLLABORATION_STATE]` was rendered for that frozen
ContextManifest. Core renders the section when Bootstrap requires a complete initial projection or when the complete
projection digest differs from `conversation.native_collaboration_state_digest`. Self identity edits and internal
changes that leave the final projection equal do not cause a refresh.

Runtime Input Delivery freezes the Manifest's complete digest and inclusion evidence. Only an accepted Runtime Input
ACK advances `conversation.native_collaboration_state_digest` to that digest. Send failure, `delivery_unknown`,
process loss, `not_accepted` and any input without accepted ACK do not advance it; a later input must retry the current
projection.

### Current-only contract break

The current contract axes are Bootstrap v3, Bootstrap Formatter v3, AgentRun Context Formatter v11 and
ContextManifest v8. Migration 67 admits only the exact v0.48/schema-26/migration-66 source, invalidates current old
Bindings and Native Sessions, fails non-terminal old Runs/Turns, and deletes old Bootstrap/Manifest/Runtime Input and
Session-bound technical table rows and reachable references. Unreferenced content-addressed Managed Blob bytes remain
eligible for the existing generic garbage collector. Completed Camp, message, Task, Conversation and terminal Run/Turn
business history is preserved.

New evidence tables accept only v3/3/11 and non-null inclusion. There is no old `members`/`defaultLead` translation,
dual write, nullable inclusion, old formatter read path or Resume compatibility branch. This release migration is a
contract clean break; it is not Session rotation caused by an identity edit.

The Session Charter publishes these stable rules:

```text
MEMBER_IDENTITY is the sole self-identity projection for this Native Session.
COLLABORATION_STATE describes peer routing identity only and never updates,
patches, or overrides self identity.
```

## Consequences

- A model sees one atomic six-field self identity for the Session and a separate minimal peer directory.
- Self identity edits retain eligible-Bootstrap eventual consistency and can no longer leak as partial Dynamic Context
  updates.
- Presence and leave-request churn does not create duplicate Collaboration State delivery when model-visible routing
  identity is unchanged.
- Peer Name, Team Role, Responsibilities, membership and Lead changes remain refreshable through the next accepted
  Dynamic Context.
- The digest name has one global meaning: the complete current Collaboration State v2 projection.
- Old technical context evidence is intentionally discarded during the one-time upgrade; business history remains.

## Rejected Alternatives

- Include self with all six fields in Collaboration State: rejected because it duplicates Bootstrap identity on every
  relevant Dynamic Context and creates a second lifecycle owner.
- Keep the existing three-field self entry and add an identity version: rejected because it still creates partial self
  identity and adds history/version machinery outside the requested boundary.
- Force a new Native Session after every identity edit: rejected because identity edit does not own Session lifecycle
  and eligible Bootstrap eventual consistency is intentional.
- Emit `[MEMBER_IDENTITY_UPDATE]` on the next Run: rejected because it adds a per-Run patch protocol and a second self
  identity authority.
- Digest internal Member State and suppress identical bytes later: rejected because internal changes would still own
  delivery evidence and the digest would not identify the model projection.
- Preserve v2/v10 Context evidence through unions and nullable inclusion: rejected because old digests are not complete
  Collaboration State v2 digests and would make the new field semantics conditional on historical compatibility.

## References

- [ADR-0100: Latest Member Identity in Native Session Bootstrap](0100-latest-member-identity-native-session-bootstrap.md)
- [ADR-0129: Deterministic Bounded Raw Public Context Delivery](0129-deterministic-bounded-raw-public-context-delivery.md)
- [ADR-0138: Durable Bootstrap Redelivery Requirement](0138-durable-bootstrap-redelivery-requirement.md)
- [ADR-0141: Atomic Bootstrap Redelivery Input Overlay](0141-atomic-bootstrap-redelivery-input-overlay.md)
- [Collaboration State v2](../contracts/collaboration-state-v2.md)
- [v0.50 overview](../versions/v0.50/README.md)
- [Domain terminology](../../CONTEXT.md)
