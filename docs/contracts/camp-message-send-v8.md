---
document_type: protocol-contract
contract: camp-message-send-v8
authority: camp-public-a2a-send
status: accepted
version: 8
last_updated: 2026-08-16
---

# Camp Message Send v8 Contract

v8 replaces [Camp Message Send v7](camp-message-send-v7.md). v7 closed input, line-leading display-name alias,
Structured Content, Current User Attention, Task admission, canonical recipient freeze, reply reference, atomicity and
ordinary forward/return behavior remain unchanged. v8 adds one durable Gather return exception and accurate split
budget projection.

For each Effective Recipient, Core first performs the normal edge classification. An exact Immediate Caller return is
then `gather_captured` only when the source AgentRun is the current target Run and retry generation of a collecting
GatherItem and the recipient is that Gather's frozen initiator. This decision uses persisted identity links only. Body,
display name, Mention spelling, reply prose, current Default Lead, process memory and time windows are forbidden inputs.

The CampMessage, Structured Mention, reply reference, recipient presentation, search/index and Renderer projection are
identical to an ordinary public send. The captured Delivery is included in `effectiveRecipients` and `deliveryIds`,
consumes one accepted-A2A slot, and is atomically persisted settled with no attempt or target AgentRun. Other recipients
of the same message remain ordinary dispatch Deliveries; mixed capture/forward sends are atomic.

The canonical result retains v7 fields. `allocatedAgentRunResponsibilities` now projects the independent responsibility
ledger rather than recipient Delivery count. A captured-only return increases acceptedA2a but not that result. Budget
failure remains all-or-nothing, and a captured message is never accepted for free after the accepted-A2A limit.

Public return evidence does not close a GatherItem. Item settlement, fallback and Barrier are governed by
[Gather v1](gather-v1.md).

## References

- [ADR-0193](../versions/v0.89/decisions.md#adr-0193)
- [Camp Message Send v7 (historical)](camp-message-send-v7.md)
- [Message Delivery v3](message-delivery-v3.md)
- [Gather v1](gather-v1.md)
