---
document_type: protocol-contract
contract: context-manifest-evidence-v13
authority: agent-run-context-evidence
status: accepted
version: 13
last_updated: 2026-08-16
---

# ContextManifest Evidence v13 Contract

v13 replaces [ContextManifest Evidence v12](context-manifest-evidence-v12.md). v12 source, selection, truncation,
omission, Structured Mention, Profile, exact Dynamic Context bytes/digest, Bootstrap linkage and Runtime Input Delivery
ACK/recovery semantics remain. v13 uses AgentRun Context Formatter v15 and adds the `gather_completion` invocation.

For a completion Run, Current Input is the exact immutable `gather_completed` payload frozen by Gather v1. It is a
mandatory final section and cannot be evicted or partially omitted to retain optional history. The Manifest records:

```text
invocationKind=gather_completion
gatherId, completionDeliveryId, requestMessageId
completionInputSchemaVersion, completionInputDigest, completionInputByteLength
ordered GatherItem and captured-message references
Gather snapshot digest
FormatterVersion=15 and exact rendered Dynamic Context bytes/digest
```

The Manifest verifies that completion Delivery, Gather, request message, target Run and frozen input agree. It does not
duplicate full public bodies or fallback text outside the exact frozen Current Input. Captured references keep stable
message/source/generation/sequence/content digest facts; exact content remains authorized through normal Camp reads.

Recovery reads exact frozen Delivery/Manifest bytes. It must not rebuild input from current Gather rows, public history,
Default Lead, Native Session or recipient display state. Only Runtime Input Delivery accepted ACK advances watermarks;
preflight, AgentRun creation, send failure and `delivery_unknown` retain v12 meanings.

Context Delivery Profile v3 does not change: it still owns optional public history selection/order/budgets, while the
new mandatory trigger shape and 48 KiB Gather input bound are owned by Gather v1, Formatter v15 and this Manifest.

## References

- [ADR-0194](../versions/v0.89/decisions.md#adr-0194)
- [Gather v1](gather-v1.md)
- [ContextManifest Evidence v12 (historical)](context-manifest-evidence-v12.md)
- [Context Delivery Profile v3](context-delivery-profile-v3.md)
