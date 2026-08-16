---
document_type: protocol-contract
contract: gather-v2
authority: gather-lifecycle-and-barrier
status: accepted
version: 2
last_updated: 2026-08-16
---

# Gather v2 Contract

v2 replaces [Gather v1](gather-v1.md) as the current entry. The v1 operation, Default Lead gate, one shared body,
canonical 1..16 recipients, one public request, N optional forward Deliveries/Items, reserved completion responsibility,
durable initiator route, terminal authority, Barrier CAS, Completion FIFO, cancellation and retry lifecycle remain.

## 1. Captured-return allowance and authority

An exact current-Item return to the frozen initiator remains a public CampMessage and a settled
`public_a2a/gather_captured` Delivery without a target Run. It consumes neither the CampTurn accepted-A2A ledger nor
an AgentRun responsibility. It is instead admitted against an independent maximum of 16 captured returns per
`dispatchDeliveryId + sourceAgentRunId + activeRetryGeneration`. The active CampTurn deadline and lifecycle gates
still apply. The seventeenth return is rejected atomically as `message.execution_budget_exceeded`, with
`details.limitScope=gather_captured_messages_per_item_generation`; mixed-recipient sends remain all-or-nothing.

Captured Deliveries are never deleted. They remain public audit facts, but only the exact current target Run and active
retry generation are eligible for the current completion. Within that eligible set, the highest
`CampMessage.sequence, messageId` is the sole authoritative captured result. Earlier progress messages and all prior
generation returns are excluded from v2 Completion Input. A successful member terminal uses its bounded final-output
fallback only when the current generation has no captured return.

Member Dynamic Context must teach this convention: progress sends are allowed, but the last accepted `rovai send` or
public `@Lead` return must contain the complete conclusion. A normal Runtime final output is only the zero-capture
fallback.

## 2. Self-contained mandatory Completion Input

When the Barrier wins, it freezes schema v2 with a maximum canonical serialized size of 512 KiB. This bound covers
worst-case JSON escaping of the accepted 32 KiB request and all 16 bounded fallbacks; it is not a new input allowance:

```text
schemaVersion=2
source={type:gather_completed}
gatherId, commandId, requestMessageId
request={messageId, body, contentDigest}
items=[
  recipientAgentId, dispatchDeliveryId, activeRetryGeneration,
  targetAgentRunId?, terminal status/source,
  capturedMessages[0..1], fallbackSummary?, error?
]
```

`request.body` is the durable public request body owned by `requestMessageId`; its digest must equal the bound
CampMessage digest. Each captured result must match the Item's current target Run, dispatch Delivery and active retry
generation. Item identity, the full request and result references are mandatory and may not be evicted to preserve
optional history. The raw payload validates against
[`gather-completion-input-v2.schema.json`](schemas/gather-completion-input-v2.schema.json) after catalog digest
verification.

## 3. Upgrade and recovery

Collecting Gathers build only v2 inputs after upgrade. Already-ready/completing v1 Gathers, pending v1 Completion
Deliveries, frozen Formatter v15 contexts and stored Formatter v15 manifests remain valid immutable recovery inputs;
they are not rewritten into v2. A ready Gather never reopens to obtain newer semantics.

Budget cost is now: Gather forward `acceptedA2a=1/runResponsibility=1`; ordinary non-captured return `1/1`; captured
return `0/0` plus the independent bound above; completion `0/1`, reserved at acceptance. The ordinary CampTurn maximum
is not removed or increased.

## References

- [ADR-0195](../adr/0195-generation-scoped-last-gather-return.md)
- [ADR-0196](../adr/0196-self-contained-gather-completion-request.md)
- [Camp Message Send v9](camp-message-send-v9.md)
- [Message Delivery v4](message-delivery-v4.md)
- [ContextManifest Evidence v14](context-manifest-evidence-v14.md)
