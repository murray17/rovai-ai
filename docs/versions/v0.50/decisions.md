---
document_type: version-decisions
version: v0.50
lifecycle: historical
last_updated: 2026-08-18
---

# v0.50 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0146](#adr-0146) | Sole Native-Session Self Identity and Peer Routing Projection | `accepted` |
| [ADR-0147](#adr-0147) | Lossless Model Context Projection and Layered Delivery Evidence | `accepted` |

<!-- legacy-adr:begin id=ADR-0146 source-file-sha256=7bd9c0d990d03532f4b6ae8e02eb4a1a38de00813f9a7fc1b3728e86f91af989 -->
<a id="adr-0146"></a>

## ADR-0146: Sole Native-Session Self Identity and Peer Routing Projection

迁移时原路径：`docs/adr/0146-sole-native-session-self-identity-and-peer-routing-projection.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0146
title: Sole Native-Session Self Identity and Peer Routing Projection
status: accepted
date: 2026-08-09
decision_scope: cross-version
source_version: v0.50
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0146 -->
<a id="adr-0146-context"></a>
### Context

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

<a id="adr-0146-decision"></a>
### Decision

<a id="adr-0146-member_identity-is-the-sole-self-identity"></a>
#### `MEMBER_IDENTITY` is the sole self identity

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

<a id="adr-0146-collaboration_state-is-peer-routing-identity"></a>
#### `COLLABORATION_STATE` is peer routing identity

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

<a id="adr-0146-digest-and-inclusion-are-separate-evidence"></a>
#### Digest and inclusion are separate evidence

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

<a id="adr-0146-current-only-contract-break"></a>
#### Current-only contract break

The current contract axes are Bootstrap v3, Bootstrap Formatter v3, AgentRun Context Formatter v11 and
ContextManifest v8. Migration 68 admits only the exact v0.48/schema-26 source with Migrations 66 and 67 applied, invalidates current old
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

<a id="adr-0146-consequences"></a>
### Consequences

- A model sees one atomic six-field self identity for the Session and a separate minimal peer directory.
- Self identity edits retain eligible-Bootstrap eventual consistency and can no longer leak as partial Dynamic Context
  updates.
- Presence and leave-request churn does not create duplicate Collaboration State delivery when model-visible routing
  identity is unchanged.
- Peer Name, Team Role, Responsibilities, membership and Lead changes remain refreshable through the next accepted
  Dynamic Context.
- The digest name has one global meaning: the complete current Collaboration State v2 projection.
- Old technical context evidence is intentionally discarded during the one-time upgrade; business history remains.

<a id="adr-0146-rejected-alternatives"></a>
### Rejected Alternatives

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

<a id="adr-0146-references"></a>
### References

- [ADR-0100: Latest Member Identity in Native Session Bootstrap](../v0.35/decisions.md#adr-0100)
- [ADR-0129: Deterministic Bounded Raw Public Context Delivery](../v0.44/decisions.md#adr-0129)
- [ADR-0138: Durable Bootstrap Redelivery Requirement](../v0.48/decisions.md#adr-0138)
- [ADR-0141: Atomic Bootstrap Redelivery Input Overlay](../v0.48/decisions.md#adr-0141)
- [Collaboration State v2](../../contracts/collaboration-state-v2.md)
- [v0.50 overview](README.md)
- [Domain terminology](../../../CONTEXT.md)
<!-- legacy-adr-body:end id=ADR-0146 -->
<!-- legacy-adr:end id=ADR-0146 -->

<!-- legacy-adr:begin id=ADR-0147 source-file-sha256=c90e7f477054017a85cf3b3c3f2a646eb2b6955f889497165919742ce93bfcc0 -->
<a id="adr-0147"></a>

## ADR-0147: Lossless Model Context Projection and Layered Delivery Evidence

迁移时原路径：`docs/adr/0147-lossless-model-context-projection-and-layered-delivery-evidence.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0147
title: Lossless Model Context Projection and Layered Delivery Evidence
status: accepted
date: 2026-08-09
decision_scope: cross-version
source_version: v0.50
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0147 -->
<a id="adr-0147-context"></a>
### Context

AgentRun Dynamic Context currently carries several facts needed to verify selection, truncation and source integrity
inside the same JSON objects the model consumes. That shape makes model-facing messages resemble audit records and
encourages two unsafe responses: either keep copying internal evidence into every prompt, or delete evidence in the
name of reducing prompt size.

Neither is correct. A model needs a privacy-filtered, actionable projection; Core needs enough immutable evidence to
verify how that projection was produced; Runtime delivery needs a separate accepted-input fact; and the underlying
Camp, Message, Task, Member and Memory records remain the business authorities. A digest or reference in one layer
cannot stand in for another.

<a id="adr-0147-decision"></a>
### Decision

<a id="adr-0147-four-authorities-stay-separate"></a>
#### Four authorities stay separate

Rovai maintains four distinct layers:

1. **Context Source State** is current authoritative internal domain state. It is not copied wholesale into a prompt
   or ContextManifest.
2. **Model Context Projection** is the versioned, privacy-minimized field set serialized for model consumption. It
   may use dedicated internal DTOs, but its public domain names and values remain canonical.
3. **Context Projection Evidence** for AgentRun Dynamic Context is the immutable ContextManifest evidence needed to
   verify source references, content digests, selection, order, truncation, omission and exact rendered Dynamic
   Context bytes. It is not a complete source-value snapshot and does not prove Runtime acceptance or model
   understanding.
4. **Runtime Input Delivery Evidence** binds one Manifest to the AgentRun execution epoch, Native Binding generation
   and delivery versions. Only its accepted acknowledgement may advance frozen watermarks. It neither chooses model
   fields nor duplicates the complete source evidence.

Message Delivery creation, AgentRun materialization, transport send, send failure and `delivery_unknown` are not
accepted-input evidence. Failure, process loss, `delivery_unknown` and any input not accepted leave all affected
watermarks unchanged.

Bootstrap retains its existing evidence and privacy boundary: stable Session Charter and Memory Entrypoint components
use Bootstrap Evidence, complete `MEMBER_IDENTITY` and combined Bootstrap bytes remain transient, and Redelivery does
not move them into ContextManifest or Runtime Input Delivery.

<a id="adr-0147-model-projection-may-be-compact-but-not-lossy-or-renamed"></a>
#### Model projection may be compact, but not lossy or renamed

Model-facing Dynamic Context uses compact JSON and omits semantically empty defaults. Dedicated model DTOs are an
internal projection boundary, not a second public vocabulary. Existing names such as `messageId`, `sequence`,
`senderType`, `senderId` and `replyToMessageId` remain; aliases such as `id`, `seq`, `from`, `replyTo`, `more` and a
custom `locator` protocol are not introduced.

For historical public messages, model projection keeps the fields needed to understand and retrieve the message.
`sourceConversationId` and attachment `contentDigest` are evidence rather than model fields. Historical attachment
projection keeps the authorized `name`, `mediaType` and `path`. Empty attachments and absent reply/source fields are
omitted. An untruncated body omits `bodyLength`, `bodyTruncated: false` and null continuation state. A truncated body
retains an explicit truncation fact in the `continuation` field, whose operation input maps without translation to the current
canonical `camp.read` item schema:

```json
{
  "operation": "camp.read",
  "input": {
    "campId": "camp-123",
    "mode": "item",
    "messageId": "message-123",
    "bodyOffset": 2000
  }
}
```

`bodyLimit` may be present as the canonical optional operation field. Core reauthorizes every referenced ID when the
operation is invoked; the continuation is not an authorization token.

Whole omitted history has no executable sequence-range read schema. Its model projection contains only the exact
omitted count, the minimum/maximum sequence envelope, a short non-assumption rule and navigation guidance toward
available canonical operations such as `camp.read` and `camp.search`. The envelope may contain gaps and is not tool
input. Exact omitted message IDs, selection reasons and omission reasons remain ContextManifest evidence. The model
aggregate and machine evidence are therefore not merged into one `omissions` object.

Compact serialization must not change field values, message selection, ordering, reference distance, boundaries,
privacy filtering, authorization or evidence. `CURRENT_INPUT` remains complete, appears on every Run at the final
Dynamic Context position, and is never silently truncated or evicted as history.

<a id="adr-0147-stable-rules-and-per-run-facts-are-not-duplicated"></a>
#### Stable rules and per-Run facts are not duplicated

The Session Charter owns stable Task and coordination rules: Task create/update does not notify or wake an assignee;
Task get/list is not a waiting or polling primitive; and later Task changes do not retarget an already accepted Run.
It also publishes this mandatory invariant verbatim:

```text
Completing a Task or the current work does not by itself require an additional
peer-coordination send. Use an additional `rovai send` for peer coordination
only when a target Member needs the message to continue acting or decide.
This rule does not replace Runtime-specific public-output delivery requirements.
```

This gate applies only to an additional peer-coordination send. It does not restrict `rovai send` when a Runtime's
public-output contract requires that command to deliver an ordinary user-visible result.

An A2A Task Run Notice carries only the frozen per-Run fact:

```json
{
  "code": "a2a_task_context",
  "taskId": "task-123",
  "message": "This Task is historical context; later Task changes do not retarget this Run."
}
```

ContextManifest freezes the typed Task reference, notice code, exact rendered bytes and digest. It does not copy a
mutable Task snapshot, and Runtime Input Delivery does not duplicate that evidence. The accepted Message Delivery /
AgentRun frozen Task association remains the Core authority regardless of later Task edits.

The Charter title is `Rovai Built-in CLI Contract` without an application release suffix. Contract versions remain
Core evidence and compatibility state, not model text. No Built-in Tool catalog version or catalog digest is added to
Bootstrap Evidence: Charter bytes/digest already prove the stable model-visible wording, while invocation-time CLI
context and compatibility checks retain their existing, separate authority.

<a id="adr-0147-version-axes-follow-their-actual-owners"></a>
#### Version axes follow their actual owners

Context Delivery Profile owns deterministic public-context candidate selection, ordering, Unicode-scalar measurement,
truncation and Profile budget values. Model DTO fields, wording and JSON serialization belong to the AgentRun Context Formatter;
ContextManifest evidence fields belong to the Manifest version; Bootstrap model shape belongs to Bootstrap and its
Formatter; redelivery marker and wording belong to the Redelivery Envelope and Formatter.

This projection-only change does not alter Profile v2 selection, priorities or numeric budgets, so it does not create
a Profile v3. It also does not introduce estimated-token budgets, per-section eviction, Collaboration Delta,
Memory-Entrypoint reprioritization or a changed 96 KiB Runtime payload gate. That existing Runtime/combined-payload
gate is separate from Profile v2 public-context budgets.

The unreleased v0.50 Bootstrap v3, Bootstrap Formatter v3, AgentRun Context Formatter v11 and ContextManifest v8
work is one draft contract boundary. Discussion steps and intermediate commits do not create
v4/v12/v9 compatibility identities. The final v0.50 draft keeps those versions, Profile v2 and Data Contract
v0.50/schema 27/Migration 68.

Redelivery is different: Envelope v1 and Formatter v1 already form a persisted v0.48 contract. Changing the opening
marker schema and model-visible recovery wording therefore creates Redelivery Envelope v2 and Formatter v2:

```text
[ROVAI_BOOTSTRAP_REDELIVERY reason="context_compaction"]
This is Core recovery context for the existing Native Session, not a new task or Session.

<complete Native Session Bootstrap>
[/ROVAI_BOOTSTRAP_REDELIVERY]
```

The single sentence is required recovery authority, not optional explanatory prose. ContextManifest remains
Dynamic-Context-only. Runtime Input Delivery continues to retain only the selected Requirement revision, Bootstrap
Evidence reference, presence and envelope/formatter versions; it does not retain the overlay, identity bytes or a
combined digest. Existing prepared/accepted/failure/`delivery_unknown` semantics do not change.

<a id="adr-0147-consequences"></a>
### Consequences

- Prompt compaction can remove non-actionable evidence fields without weakening exact recovery, accepted-ACK,
  privacy or authorization boundaries.
- ContextManifest must contain the exact source, attachment, truncation and omission evidence required to verify the
  final projection; a digest alone cannot identify or verify the source references, selection, truncation and omission
  basis.
- Profile v2 remains stable because its selection and budgets are unchanged; Formatter and Manifest versions cannot
  be used as aliases for Profile semantics.
- Current Input, complete Collaboration State v2, Memory Entrypoint selection, public reference closure and Core
  live authorization retain their existing contracts.
- The v0.50 review that produced this ADR is a decision record, not proof that the final projection has been
  implemented or validated.

<a id="adr-0147-rejected-alternatives"></a>
### Rejected Alternatives

- Rename domain fields to shorter aliases or add `more`/custom locator vocabulary: rejected because it creates a
  second protocol and obscures canonical operation inputs.
- Merge model omission aggregates with exact omission evidence: rejected because it leaks internal selection facts
  and confuses navigation guidance with audit evidence.
- Replace complete Collaboration State v2 with stateful deltas: rejected because accepted digest continuity does not
  prove the model retained a prior generation after compaction.
- Introduce estimated-token budgets or reprioritize history, Collaboration, Bootstrap or Memory in this cutover:
  rejected because there is no versioned deterministic estimator or benchmark basis, and it would change selection.
- Remove source references, content digests, exact selection, payload digest or omission reason to save prompt space:
  rejected because those facts belong outside the prompt, not outside evidence.
- Keep Redelivery v1 after changing its marker and wording: rejected because v1 is already persisted evidence and its
  formatter identity has real compatibility meaning.
- Persist the complete redelivery overlay or identity-bearing digest: rejected because it violates the transient
  Member Identity boundary without improving accepted-input proof.

<a id="adr-0147-references"></a>
### References

- [v0.50 Context Projection review](model-context-projection-review.md)
- [ADR-0067: Native Session Bootstrap and AgentRun Context v3](../v0.21/decisions.md#adr-0067)
- [ADR-0129: Deterministic Bounded Raw Public Context Delivery](../v0.44/decisions.md#adr-0129)
- [ADR-0132: Bounded Public Reference Context Closure and Profile v2](../v0.45/decisions.md#adr-0132)
- [ADR-0141: Atomic Bootstrap Redelivery Input Overlay](../v0.48/decisions.md#adr-0141)
- [ADR-0146: Sole Native-Session Self Identity and Peer Routing Projection](decisions.md#adr-0146)
- [Context Delivery Profile v2](../../contracts/context-delivery-profile-v2.md)
- [Domain terminology](../../../CONTEXT.md)
<!-- legacy-adr-body:end id=ADR-0147 -->
<!-- legacy-adr:end id=ADR-0147 -->
