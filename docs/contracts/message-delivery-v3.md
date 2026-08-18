---
document_type: protocol-contract
contract: message-delivery-v3
authority: message-delivery-lifecycle
status: accepted
version: 3
last_updated: 2026-08-16
---

# Message Delivery v3 Contract

v3 replaces [Message Delivery v2](message-delivery-v2.md) as the current entry. v2 public forward/return lineage,
recipient FIFO, attempt fence, wait conditions, explicit retry/cancel, Context gate and event-driven recovery remain;
v3 adds durable Gather capture/completion and generation-aware materialization.

## 1. Closed persisted union

Shared dispatch fields are id, Camp/Turn, recipient, queueSequence, status/phase/wait, attempts, retryGeneration,
current targetAgentRunId, completionRole, frozen snapshot and timestamps. The discriminants are:

```text
deliveryKind = public_a2a | gather_completion
dispatchDisposition = dispatch | gather_captured
completionRole = required | optional | null
```

| kind / disposition | message / edge | role | target | lifecycle |
| --- | --- | --- | --- | --- |
| `public_a2a / dispatch` | CampMessage, `forward | return` | required normally; optional for Gather forward | canonical recipient | normal pump |
| `public_a2a / gather_captured` | CampMessage, exact `return` | null | frozen Gather initiator | immediately settled; no attempt/Run |
| `gather_completion / dispatch` | requestMessageId as causality, no public recipient | required | original initiator + targetConversationId | normal pump |

Public rows require recipient canonical position/digest, message/body digest, edge, A2A root/depth, lineage and
presentation. Completion rows require gatherId, targetConversationId and completion input digest; public-only fields
are null and they never join request-message Effective Recipients. Captured rows require gatherId and
gatherDispatchDeliveryId. Dispatchable rows require a non-null completionRole.

Historical v2 rows migrate to `public_a2a/dispatch`, keep their edge/lineage and receive `required`; no capture is
inferred from body, recipient, Mention or reply metadata.

## 2. Dispatch and materialization

Both dispatchable kinds use the same recipient queue and Dispatch Pump. Public A2A resolves/creates the recipient
Conversation and materializes an `a2a` Run. Gather completion validates and uses its frozen targetConversationId and
materializes a `gather_completion` Run. In both cases target busy, Runtime unavailable, capacity unavailable, Context
too large, attempt evidence and explicit recovery keep their existing meanings.

AgentRun freezes `triggerDeliveryGeneration`. A Delivery's targetAgentRunId is only the current generation pointer;
historical Runs remain bound by `(triggerMessageDeliveryId,triggerDeliveryGeneration)`. The uniqueness rule is one Run
per Delivery generation, not one Run forever per Delivery. Retry clears the current pointer only after the prior
generation is terminal and never rewrites prior attempts/Runs.

Completion materialization additionally CAS-writes Gather.completionRunId. Once present, Delivery retry cannot create a
second continuation. Completion Run fields are:

```text
invocationKind=gather_completion, completionRole=required,
triggerCampMessageId=requestMessageId, triggerMessageDeliveryId=completionDeliveryId,
a2aParentAgentRunId=null, a2aRootAgentRunId=null, a2aDepth=0
```

## 3. Settlement and CampTurn

Delivery-level completionRole is authoritative before a target Run exists. CampTurn recompute treats pending/running
Deliveries as nonterminal, failed required Deliveries as fatal and failed optional Gather forwards as aggregate data.
Materialized Runs inherit the Delivery role. A captured return is terminal and never hides its CampMessage.

Terminal dispatch, current Run terminal, retry and cancellation update the linked GatherItem/Barrier in the same
transaction. Completion Run terminal updates its Gather status in the same transaction. No periodic or startup-global
dispatch is added; `interrupted_before_dispatch` remains explicit-user recovery.

## 4. Read Side and evidence

Read models expose a discriminated union rather than freely combinable nullable fields. Public variants expose message,
edge and lineage; captured variants also expose capture linkage; completion variants expose Gather and frozen target
Conversation but are not public message recipients. AgentRun invocationKind becomes
`direct | a2a | gather_completion` and exposes triggerDeliveryGeneration.

Events include kind, disposition, completionRole, generation and applicable Gather locators. Evidence never copies
message body, captured excerpt, fallback or completion Current Input.

## References

- [ADR-0193](../versions/v0.89/decisions.md#adr-0193)
- [Gather v1](gather-v1.md)
- [Message Delivery v2 (historical)](message-delivery-v2.md)
- [Public A2A architecture](../architecture/public-a2a-message-delivery.md)
