---
document_type: protocol-contract
contract: gather-v3
authority: proposed-gather-lifecycle-and-barrier
status: proposed
version: 3
last_updated: 2026-08-18
---

# Gather v3 Contract (Proposal)

Model-context revision 1 is confirmed. This proposal would replace [Gather v2](gather-v2.md) only after its own
acceptance and implementation; v2 remains the accepted current entry. v3 preserves the v2 operation, Default Lead gate, recipients,
request publication, Item/Delivery lifecycle, captured-return allowance, last-current-generation selection, fallback,
Barrier CAS, Completion FIFO, cancellation, retry, limits and budget semantics. It changes only the frozen
Agent-facing message projection in Completion Input.

## Why a new completion-input version is required

Gather v2 freezes `request.body` and the selected `capturedMessages[].bodyExcerpt` at the Barrier. Those strings are
already part of the completion input digest before Context Formatter materializes the `gather_completion` Run. A
Formatter-only replacement of `@你` with `@Principal` would therefore be too late, would not be segment-aware and
would make replay disagree with the frozen completion payload.

Gather v3 renders every Structured CampMessage-backed body through the Agent audience at the Barrier. The only
segment delta is `CurrentUserMention(local_user) -> @Principal`; source Structured Content and `contentDigest` remain
unchanged. Runtime-final `fallbackSummary` is literal Runtime text rather than a Structured CampMessage projection and
retains v2 bytes unchanged.

## Closed Completion Input v3

The payload remains mandatory, self-contained, canonical JSON, bounded to 512 KiB and contains 1..16 Items. Its
complete shape is v2 plus the required projection evidence shown below:

```text
schemaVersion = 3
messageProjectionAudience = "agent_v1"
source = { type: "gather_completed" }
gatherId, commandId, requestMessageId
request = {
  messageId,
  body,
  contentDigest,
  projectedBodyDigest
}
items = [{
  recipientAgentId,
  dispatchDeliveryId,
  activeRetryGeneration,
  targetAgentRunId: string | null,
  status: "succeeded" | "failed" | "cancelled" | "interrupted_before_dispatch",
  terminalSource: "delivery" | "agent_run",
  capturedMessages: [{
    messageId,
    sourceAgentRunId,
    retryGeneration,
    sequence,
    contentDigest,
    bodyProjectionAudience: "agent_v1",
    projectedBodyDigest,
    bodyExcerpt,
    bodyOriginalBytes,
    bodyTruncated
  }] (0..1),
  fallbackSummary: {
    body,
    contentDigest,
    originalBytes,
    truncated
  } | null,
  error: {
    code,
    terminalResolutionSource: string | null,
    terminalReasonCode: string | null,
    manualRetryAllowed: false
  } | null
}]
```

`request.body` is the complete Agent projection of the authoritative request Structured Content;
`request.projectedBodyDigest` is SHA-256 of those exact UTF-8 bytes. For a selected captured message,
`projectedBodyDigest` covers the complete Agent projection, `bodyExcerpt` is the existing at-most-1024-byte bounded
UTF-8 prefix of that projection, `bodyOriginalBytes` is that complete projection's UTF-8 byte length, and
`bodyTruncated` states whether the prefix omitted bytes. `contentDigest` in both locations continues to bind the
audience-independent Structured Content.

The top-level audience applies to `request.body` and every Structured CampMessage-backed captured body. The repeated
captured-message audience is intentional local evidence for consumers that persist or validate captured references
independently. No audience marker applies to `fallbackSummary`.

## Manifest, upgrade and recovery

ContextManifest v17 records `completionInputSchemaVersion=3`, the exact input digest/byte length and ordered source
references exactly as v16 does for v2. The complete rendered Dynamic Context digest additionally proves that the
frozen v3 object reached the model. Formatter 19 accepts v3 only; it never reparses, rewrites or upgrades a v2 payload.

The v1.07 development-data clean break preserves no v2 Gather rows or frozen input. No v2 Gather is cancelled into a
compatible history record, reopened, translated or resumed under v3 projection semantics; the new store creates v3
inputs only.

## References

- [v1.07 model-context revision 1](../versions/v1.07/model-context-change-a2a-public-only.md)
- [Gather v2 (accepted predecessor)](gather-v2.md)
- [ContextManifest Evidence v17 proposal](context-manifest-evidence-v17.md)
- [ADR-0218](../adr/0218-audience-specific-principal-message-projection.md)
