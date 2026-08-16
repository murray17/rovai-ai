---
document_type: adr
id: ADR-0200
title: Compact AgentRun Context Projection and Structured Run Facts
status: accepted
date: 2026-08-16
decision_scope: cross-version
source_version: v0.94
supersedes: []
superseded_by: null
---

# ADR-0200: Compact AgentRun Context Projection and Structured Run Facts

## Context

The current Session Charter repeats command-specific teaching that exact CLI help and typed Core recovery already own.
Historical public-message projection also repeats evidence-oriented fields and a complete `camp.read` input for every
truncated message. `RUN_NOTICES` expresses stable machine facts as English templates, which costs prompt space and
makes consumers infer semantics such as Gather retry-generation fallback from prose.

Those bytes can be reduced without changing context selection, public-history budgets, source authority or immutable
evidence. The compact projection must nevertheless preserve invocation-time reauthorization, exact retrieval offsets,
full-message mention semantics, omission-envelope caveats and the current Collaboration State routing signal.

## Decision

### Charter remains stable authority, not command documentation

The Session Charter keeps only stable authority boundaries, the fixed fifteen-command discovery surface, one-input-
source rule, Camp-visible `rovai send` obligation, message-local user attention and accepted-send proof boundary.
Command-specific member creation, Gather workflow, Envelope/output details and `confirm_outcome` teaching move to exact
operation help or typed Core recovery.

The Charter explicitly states that Core reauthorizes every operation at invocation and projected IDs/facts are not
authorization tokens. It also defines the compact history invariants: one top-level Camp applies to every projected
message, `nextBodyOffset` is a Unicode-scalar `camp.read item.bodyOffset`, and omitted sequence bounds may have gaps
and are not executable ranges. Exact current wording belongs to the Session Charter bytes recorded by Bootstrap
Evidence; Bootstrap v3 and Bootstrap Formatter v3 remain because the Bootstrap section shape and assembly are
unchanged.

### Shared Conversation uses one Camp and compact message continuation

`SHARED_CONVERSATION` adds required top-level `campId`, equal to the frozen AgentRun Camp. Every origin, reference-
closure and recent message in the projection must come from that Camp. A model-visible historical message contains:

```json
{
  "messageId": "message-123",
  "sequence": 42,
  "senderType": "agent",
  "senderId": "agent_2",
  "replyToMessageId": "message-100",
  "attachments": [{"name":"migration.md","mediaType":"text/markdown","path":"/path/migration.md"}],
  "body": "projected prefix",
  "mentionsCurrentUser": true,
  "nextBodyOffset": 2000
}
```

Reply, attachments, mention and continuation remain optional. `mentionsCurrentUser` is omitted for false and may only
be literal `true` when present. Core derives it from the complete authoritative Structured Content, including a mention
beyond the projected body prefix. `nextBodyOffset` appears only when a suffix exists, counts Unicode scalar values in
the same rendered-text space as `camp.read`, and combines with top-level `campId` and the message's own `messageId`.
Model projection removes `bodyLength`, `bodyTruncated` and the complete `continuation` object.

`omittedMessages` retains only `count`, `sequenceStart` and `sequenceEnd`. The bounds are the minimum/maximum envelope
of omitted visible messages; they may contain gaps and are never operation input. The repeated `navigationHint` text
is removed. ContextManifest continues to retain per-message Camp/source identity, complete rendered body length,
truncation state, continuation offset, content/projected-body digests, attachment identity/digest and exact selection;
bounded and whole-history omission evidence remains unchanged.

This locally replaces ADR-0147's requirement that each truncated historical message carry a complete executable
operation/input object and its requirement for model-visible omission navigation prose. It preserves ADR-0149's
bounded evidence and non-executable envelope semantics. It also narrows the model-facing boolean introduced with
ContextManifest v12 to optional literal `true` without changing full-message derivation.

### Run Facts replace Run Notices

`RUN_NOTICES` and `{code, taskId?, message}` cease to be current model/evidence vocabulary. Conditional `RUN_FACTS`
schema v1 contains optional typed fields for the same authoritative trigger conditions:

- frozen A2A Task reference and the fact that later Task changes do not retarget the Run;
- lost prior Native Session continuity and required assumption recheck;
- unsettled prior external effect and reconcile-before-repeat action;
- Gather member return target, no-wake behavior, current Run/retry-generation authority and successful-final-output
  fallback only when that generation has no captured return;
- exhausted delegation budget, including that it blocks new A2A dispatch/target contact but does not by itself block
  the bounded captured Gather return.

No facts means no section; absent individual facts mean absent fields. A non-Gather exhausted-budget Run omits the
captured-return field. Its value `false` in a Gather member Run means only that delegation budget does not block that
path; live membership, lineage, recipient, generation and every other admission remain Core-authorized at invocation.
The full field contract is [Run Facts v1](../contracts/run-facts-v1.md).

ContextManifest freezes typed fact references, the exact compact Run Facts JSON bytes and their digest. This locally
replaces ADR-0067's `RUN_NOTICES` section and ADR-0147's A2A Task notice representation; the accepted frozen Task
association and current Core state remain authoritative.

### Version and clean-break boundary

AgentRun Context Formatter v17 owns the new Charter-adjacent Dynamic Context JSON shape and section name.
ContextManifest Evidence v15 owns compact history and Run Facts evidence. Context Delivery Profile v3 remains current
because selection, ordering, Unicode-scalar truncation and budgets do not change. Collaboration State remains schema
v2 with `agentId`, `name`, `teamRole` and `professionalResponsibilities`; its digest and inclusion rules do not change.

The application is unreleased. Data Contract v0.94 / projection schema 44 / Migration 89 invalidates incompatible
Manifest, frozen Delivery Context, Runtime Input Delivery, Bootstrap Evidence, Native Binding/Session and nonterminal
execution technical state, then rebuilds ContextManifest with Run Fact columns and Formatter v17 only. It preserves
completed Camp, Message, Task and terminal execution business history. There is no Formatter v16 reader, Run Notice
reader, old-column alias, dual write or downgrade path.

## Consequences

- Stable prompt bytes are shorter and exceptional facts become machine-readable without weakening source/evidence
  separation.
- A model must combine known top-level Camp, message ID and scalar offset when it elects to retrieve a suffix; each
  actual invocation is reauthorized.
- Context consumers must treat an absent mention field as false and an omission envelope as non-contiguous metadata.
- ContextManifest and TypeScript views use Run Fact terminology exclusively after the clean break.
- Any future Bootstrap or Dynamic Context change must carry a separate current-version before/after statement and a
  developer confirmation for that exact revision before implementation.

## Rejected Alternatives

- Remove `professionalResponsibilities`: rejected because `teamRole` may be empty or brand-oriented and the detailed
  responsibility remains the only reliable peer-selection signal.
- Keep natural-language notices beside facts: rejected because dual model vocabularies can drift and add prompt cost.
- Treat successful Runtime final output as an unconditional Gather fallback: rejected because failure, cancellation,
  another Run or another retry generation is not authoritative.
- Call captured Gather return generally allowed: rejected because one budget axis cannot grant admission or authority.
- Interpret omitted sequence bounds as a `camp.read` range: rejected because the set may have holes and no such
  canonical executable schema exists.
- Preserve old Manifest readers: rejected because the pre-release clean break can remove obsolete technical state and
  one current contract is safer than semantic aliases.

## References

- [v0.94 model-context change statement](../versions/v0.94/model-context-change.md)
- [ContextManifest Evidence v15](../contracts/context-manifest-evidence-v15.md)
- [Run Facts v1](../contracts/run-facts-v1.md)
- [Context Delivery Profile v3](../contracts/context-delivery-profile-v3.md)
- [Collaboration State v2](../contracts/collaboration-state-v2.md)
- [ADR-0067](0067-native-session-bootstrap-and-agentrun-context-v3.md)
- [ADR-0147](0147-lossless-model-context-projection-and-layered-delivery-evidence.md)
- [ADR-0149](0149-bounded-whole-history-omission-evidence.md)
- [ADR-0195](0195-generation-scoped-last-gather-return.md)
- [ADR-0196](0196-self-contained-gather-completion-request.md)
