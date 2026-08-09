---
document_type: adr
id: ADR-0147
title: Lossless Model Context Projection and Layered Delivery Evidence
status: accepted
date: 2026-08-09
decision_scope: cross-version
source_version: v0.50
implementation_status: complete
supersedes: []
superseded_by: null
---

# ADR-0147: Lossless Model Context Projection and Layered Delivery Evidence

## Context

AgentRun Dynamic Context currently carries several facts needed to verify selection, truncation and source integrity
inside the same JSON objects the model consumes. That shape makes model-facing messages resemble audit records and
encourages two unsafe responses: either keep copying internal evidence into every prompt, or delete evidence in the
name of reducing prompt size.

Neither is correct. A model needs a privacy-filtered, actionable projection; Core needs enough immutable evidence to
verify how that projection was produced; Runtime delivery needs a separate accepted-input fact; and the underlying
Camp, Message, Task, Member and Memory records remain the business authorities. A digest or reference in one layer
cannot stand in for another.

## Decision

### Four authorities stay separate

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

### Model projection may be compact, but not lossy or renamed

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

### Stable rules and per-Run facts are not duplicated

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

### Version axes follow their actual owners

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

## Consequences

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

## Rejected Alternatives

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

## References

- [v0.50 Context Projection review](../versions/v0.50/model-context-projection-review.md)
- [ADR-0067: Native Session Bootstrap and AgentRun Context v3](0067-native-session-bootstrap-and-agentrun-context-v3.md)
- [ADR-0129: Deterministic Bounded Raw Public Context Delivery](0129-deterministic-bounded-raw-public-context-delivery.md)
- [ADR-0132: Bounded Public Reference Context Closure and Profile v2](0132-public-reference-context-closure-profile-v2.md)
- [ADR-0141: Atomic Bootstrap Redelivery Input Overlay](0141-atomic-bootstrap-redelivery-input-overlay.md)
- [ADR-0146: Sole Native-Session Self Identity and Peer Routing Projection](0146-sole-native-session-self-identity-and-peer-routing-projection.md)
- [Context Delivery Profile v2](../contracts/context-delivery-profile-v2.md)
- [Domain terminology](../../CONTEXT.md)
