---
document_type: adr
id: ADR-0196
title: Self-Contained Gather Request in Mandatory Completion Input
status: accepted
date: 2026-08-16
decision_scope: cross-version
source_version: v0.90
supersedes: []
superseded_by: null
---

# ADR-0196: Self-Contained Gather Request in Mandatory Completion Input

## Context

The first Gather Completion input identifies the request only by `requestMessageId`. When completion runs later, the
public request may have been omitted by history selection and the Native Session may be replaced or compacted. An ID is
enough for audit lookup but not enough for the mandatory continuation to know the question, constraints and requested
output without making an additional read.

The Barrier already binds an immutable public request CampMessage and owns a mandatory Current Input. Relying on optional
history for the actual task text contradicts that durable continuation boundary.

## Decision

Every newly frozen Gather Completion input contains a mandatory request snapshot:

```text
request = { messageId, body, contentDigest }
```

The Barrier reads it from the bound request CampMessage in the same transaction that freezes completion input. The
request message identity must equal `requestMessageId`, and Context materialization verifies body and digest against the
durable CampMessage. The full body is not shortened to make room for optional history. Gather input and complete Context
receive explicit bounded ceilings large enough for the maximum accepted request and Item evidence.

The input schema, Context Formatter and ContextManifest Evidence advance together. Existing frozen schema v1 input and
Formatter v15 evidence remain exact recovery authorities and are not rewritten; new collecting Gathers produce schema
v2 and Formatter v16 evidence.

This extends ADR-0194's mandatory typed input. Conversation remains the durable route and Native Session remains a
replaceable transport binding.

## Consequences

- A completion continuation can synthesize results with the exact accepted question even when all optional public
  history is absent.
- Request bytes are duplicated in one bounded immutable completion snapshot, increasing storage and payload size.
- Recovery validation must support both historical v1 and current v2 shapes without treating legacy absence as current
  permission to omit the request.
- ContextManifest records request digest/length evidence in addition to the overall completion input digest.

## Rejected Alternatives

- **Depend on recent public history or Native Session residue.** Both are optional and can legitimately disappear.
- **Require the Lead to call `camp.read` before every synthesis.** The trigger would no longer be a self-contained
  mandatory input and a tool failure could erase the task meaning.
- **Store only a digest with the request ID.** It proves identity but does not provide model-visible instructions.
- **Truncate the request inside Completion Input.** Lost constraints are more damaging than optional history omission.
- **Rewrite stored v1 completions during migration.** That changes already-frozen bytes and violates recovery evidence.

## References

- [v0.90 版本目标](../versions/v0.90/README.md)
- [ADR-0194](0194-mandatory-typed-gather-completion-current-input.md)
- [Gather v2](../contracts/gather-v2.md)
- [ContextManifest Evidence v14](../contracts/context-manifest-evidence-v14.md)
