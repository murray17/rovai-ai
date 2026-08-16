---
document_type: protocol-contract
contract: context-manifest-evidence-v14
authority: agent-run-context-evidence
status: accepted
version: 14
last_updated: 2026-08-16
---

# ContextManifest Evidence v14 Contract

v14 replaces [ContextManifest Evidence v13](context-manifest-evidence-v13.md). v13 source/selection/truncation/
omission evidence, Context Delivery Profile v3, Bootstrap linkage, exact Dynamic Context bytes and Runtime Input
Delivery ACK/recovery remain. v14 uses AgentRun Context Formatter v16.

Formatter v16 adds the typed `gather_member_result_protocol` Run Notice to a materialized Gather member assignment and
projects Gather Completion Input schema v2 as the mandatory final Current Input. Completion evidence records:

```text
invocationKind=gather_completion
gatherId, completionDeliveryId, requestMessageId
requestContentDigest, requestBodyByteLength
completionInputSchemaVersion, completionInputDigest, completionInputByteLength
ordered Item refs including activeRetryGeneration
at most one current-generation captured-message ref per v2 Item
Gather snapshot digest
FormatterVersion=16 and exact rendered Dynamic Context bytes/digest
```

The schema v2 Current Input contains the complete durable Gather request body and digest; it cannot depend on optional
public history or Native Session residue. Gather Completion preflight has a 640 KiB complete-context ceiling, while the
serialized mandatory Gather input has its independent 512 KiB ceiling. Optional history is evicted first; mandatory
input is never partially truncated.

Formatter v14 direct/A2A manifests and Formatter v15 direct/A2A/Gather manifests remain valid exact recovery evidence.
Already-frozen schema v1 Gather Completion inputs remain readable and are never rebuilt as v2. New manifests use v16;
new collecting Gathers freeze schema v2.

## References

- [ADR-0196](../adr/0196-self-contained-gather-completion-request.md)
- [Gather v2](gather-v2.md)
- [ContextManifest Evidence v13 (historical)](context-manifest-evidence-v13.md)
- [Context Delivery Profile v3](context-delivery-profile-v3.md)
