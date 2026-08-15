---
document_type: protocol-contract
contract: gather-v1
authority: gather-lifecycle-and-barrier
status: accepted
version: 1
last_updated: 2026-08-16
---

# Gather v1 Contract

## 1. Operation and acceptance

`team.gather -> rovai gather` accepts the closed object `{to:string[],body:string}` from an authenticated active
AgentRun. The caller must be the transaction-time Camp Default Lead. `body` is required, non-blank and at most 32 KiB;
addressing, membership, self/ancestor/depth checks and canonical byte-order dedupe are inherited from
[Camp Message Send v8](camp-message-send-v8.md). The final recipient count is 1..16. V1 has one shared body and no
Task, attachment, Current User Mention, per-recipient prompt or caller-supplied Camp/Conversation/Gather identity.

One immediate transaction reserves N member Run responsibilities plus one completion responsibility and persists:

- one public request CampMessage;
- one GatherRecord;
- N `public_a2a/dispatch/optional/forward` Deliveries;
- one GatherItem per dispatch Delivery and canonical recipient;
- the command result, receipt and bounded events.

The canonical accepted result is:

```json
{"status":"accepted","gatherId":"gather_…","requestMessageId":"message_…","campTurnId":"turn_…","effectiveRecipients":["agent_2"],"dispatchDeliveryIds":["delivery_…"],"completion":"deferred"}
```

Acceptance is asynchronous. The Lead should end the current Run; continuing to occupy its Conversation causes the
future Completion Delivery to wait with `target_busy`.

Stable rejections include `gather.default_lead_required`, `gather.no_recipients`, `gather.addressing_invalid`,
`gather.fanout_exceeded`, `gather.turn_not_active`, `gather.execution_budget_exceeded` and
`gather.idempotency_conflict`, with `stop` or `fix_input` recovery as defined by Transport v13.

## 2. Persisted records

GatherRecord contains:

```text
gatherId, campId, campTurnId, requestMessageId,
initiatorAgentId, initiatorAgentRunId, initiatorConversationId, commandId,
status, version,
completionInputSchemaVersion?, completionInputJson?, completionInputDigest?,
completionDeliveryId?, completionRunId?, cancellationReasonCode?,
createdAt, readyAt?, completionStartedAt?, completedAt?, cancelledAt?, updatedAt
```

Status is `collecting | ready | completing | completed | completion_failed | cancelled`. Command, request message,
completion Delivery and completion Run identities are each unique. `initiatorConversationId` is validated at acceptance
and remains the route authority; no Session ID is persisted as route authority. Ready-or-later states require immutable
completion input and one completionDeliveryId; completionRunId is write-once.

GatherItem is keyed by `dispatchDeliveryId` and contains gatherId, recipientAgentId, activeRetryGeneration,
targetAgentRunId, status, terminalSource, bounded fallback fields, safe error/source/reason, version and timestamps.
`UNIQUE(gatherId,recipientAgentId)` enforces canonical dedupe. Item status is
`pending | running | succeeded | failed | cancelled | interrupted_before_dispatch`.

## 3. Item settlement and capture

Before target materialization, a forward Delivery `failed | cancelled | interrupted_before_dispatch` closes the Item
with `terminalSource=delivery`. Materialization writes current generation, targetAgentRunId and `running` atomically.
After that point only the current member Run's reliable `succeeded | failed | cancelled` terminal closes the Item with
`terminalSource=agent_run`.

An ordinary member send is captured only when its source Run is exactly the collecting Item's current target Run and
retry generation, the recipient is the frozen initiator, and the edge is the exact Immediate Caller return. The return
Delivery remains in the public send receipt but is persisted `gather_captured/settled`, has no attempt/target Run and
does not close the Item. Every captured reference records messageId, sourceAgentRunId, retryGeneration, sequence,
contentDigest, a maximum 1 KiB scalar-safe excerpt, original byte length and truncation.

If a successful member terminal has no captured return for its active generation, the Item stores a maximum 2 KiB
scalar-safe final-output fallback plus full digest, original byte length and truncation. Failed/cancelled Items store only
allowlisted error facts; no raw stderr, stack, SQL detail or generic full final-output body is retained.

## 4. Barrier and completion

Every Item terminal/reopen path calls one transaction-local Barrier helper. When every Item is terminal and the Gather
is still collecting, the helper verifies the active Turn and present initiator, freezes the current Camp message
high-water, builds the immutable `gather_completed` payload, validates its canonical serialized bytes are at most
48 KiB, allocates the initiator's next queue sequence, inserts exactly one `gather_completion/dispatch/required`
Delivery, and CAS-updates the Gather to ready. There is no intermediate visible state with all Items terminal and no
completion responsibility. The Barrier never inserts an AgentRun.

Completion materialization uses the frozen initiator Conversation and atomically writes the first completionRunId,
changes status to completing and creates a required `gather_completion` Run. Success changes Gather to completed;
reliable failure changes it to completion_failed. Items never reopen.

## 5. Mandatory completion input

The closed Current Input is `{source:{type:"gather_completed"},gatherId,commandId,requestMessageId,items}`. Every Item
contains recipientAgentId, dispatchDeliveryId, nullable targetAgentRunId, terminal status/source, all ordered captured
message references, nullable fallback and nullable safe error. Fallback is
`{body,contentDigest,originalBytes,truncated}`; error is
`{code,terminalResolutionSource,terminalReasonCode,manualRetryAllowed}`. Item identity or references may not be omitted
to fit a budget. Exact public content remains readable through the existing authorized `camp.read item` operation.
The frozen raw payload must validate against
[`gather-completion-input-v1.schema.json`](schemas/gather-completion-input-v1.schema.json) after its catalog raw-byte
digest has been verified.

## 6. Retry, cancellation and budget

Forward retry is allowed only while collecting. It reuses Delivery/Item identity, increments retryGeneration, clears
the current target pointer and generation-local fallback/error, and preserves historical attempts/Runs/references.
Ready wins permanently over concurrent retry. Completion Delivery may retry only before completionRunId exists.

User Stop, Camp close or initiator leave cancels Gather and any pending completion without transfer or replacement.
Default Lead change does not alter the original route. Multiple Gathers are independent and share only the initiator
recipient FIFO.

Budget cost is frozen as: Gather forward `acceptedA2a=1/runResponsibility=1`; ordinary return `1/1`; captured return
`1/0`; completion `0/1`, with the completion responsibility reserved at Gather acceptance. Both ledgers are monotonic.

## References

- [ADR-0193](../adr/0193-durable-gather-barrier-over-unified-message-delivery.md)
- [ADR-0194](../adr/0194-mandatory-typed-gather-completion-current-input.md)
- [Message Delivery v3](message-delivery-v3.md)
- [ContextManifest Evidence v13](context-manifest-evidence-v13.md)
