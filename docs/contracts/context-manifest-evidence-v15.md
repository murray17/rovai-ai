---
document_type: protocol-contract
contract: context-manifest-evidence-v15
authority: agent-run-context-evidence
status: accepted
version: 15
last_updated: 2026-08-16
---

# ContextManifest Evidence v15 Contract

v15 replaces [ContextManifest Evidence v14](context-manifest-evidence-v14.md) and uses AgentRun Context Formatter v17.
Context Delivery Profile v3 selection/order/budgets, Bootstrap Evidence linkage, Gather Completion Input v2, exact
Dynamic Context bytes and Runtime Input Delivery ACK/recovery authority remain unchanged.

## Shared Conversation evidence

Formatter v17 adds top-level model-visible `campId`; every projected origin, reference-closure and recent message must
have that same frozen AgentRun Camp in evidence. Model messages keep stable identity, optional reply/attachments, body,
optional literal-true mention and optional scalar `nextBodyOffset`. They remove model-visible `bodyLength`,
`bodyTruncated`, full continuation and omission navigation text.

For every projected historical message, `sharedMessageEvidence` still freezes:

```text
selection kind and optional reference distance
campId, messageId, sequence, senderType, senderId, optional sourceConversationId
source contentDigest and projectedBodyDigest
optional replyToMessageId
mentionsCurrentUser derived from complete Structured Content
complete rendered bodyLength, bodyTruncated, optional continuationBodyOffset
attachmentId, name, mediaType, path and contentDigest
```

`continuationBodyOffset` counts Unicode scalar values in exactly the rendered body space used by
`camp.read(mode=item).bodyOffset`. Prefix plus the authorized read suffix at that offset must reproduce the complete
rendered body, including Chinese, emoji and combining sequences. A full-message mention remains true even when the
mention lies beyond the prefix.

Whole-history and bounded omission evidence retain v14 shapes and reasons. The model's sequence start/end remains a
possibly gapped, non-executable envelope; evidence does not reinterpret it as a locator.

## Run Facts evidence

`runNoticeRefs`, `runNoticePayload` and `runNoticeDigest` are removed. v15 stores:

```text
runFactRefs: ordered typed references for each present top-level fact; Task references include taskId
runFactPayload: exact compact RUN_FACTS schema-v1 JSON text, including {"schemaVersion":1} when no section renders
runFactDigest: SHA-256 of exactly runFactPayload
```

The section renders only when at least one fact exists. Facts and triggers follow [Run Facts v1](run-facts-v1.md).
The exact payload proves formatter output but does not grant operation authorization or replace Task, Gather,
ActionExecution, Native Session or budget source state.

## Clean break and recovery

New manifests require Formatter v17. Migration 89 removes incompatible technical input/recovery state and rebuilds
ContextManifest with Run Fact columns; there is no v14 reader, v16 formatter reader, Notice alias or dual write.
Completed Camp, Message, Task and terminal execution business history remains authoritative, while a new Binding/
Session and freshly materialized v15 Manifest are required for later work.

## References

- [ADR-0200](../adr/0200-compact-context-projection-and-structured-run-facts.md)
- [Run Facts v1](run-facts-v1.md)
- [ContextManifest Evidence v14 (historical)](context-manifest-evidence-v14.md)
- [Context Delivery Profile v3](context-delivery-profile-v3.md)
- [Gather v2](gather-v2.md)
