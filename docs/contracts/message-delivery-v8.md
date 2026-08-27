---
document_type: protocol-contract
contract: message-delivery
version: 8
status: accepted
authority: public-message-delivery-managed-attachment-v2
last_updated: 2026-08-27
---

# Message Delivery v8 Contract

v8 replaces [v7](message-delivery-v7.md). Exact membership lifetime, FIFO, attempt fencing, explicit retry, zero-attempt
cancellation and terminal monotonicity remain unchanged.

A new CampMessage whose files were committed as Managed Attachment v2 creates ordinary pending Deliveries with
`dispatchPhase=never_attempted`, `dispatchAttemptCount=0`, no pre-dispatch gate and no projection operation association.
The commit wakes the normal Dispatch Pump. Attachment ingest never creates `projection_blocked`, and dispatch does not
wait for any active source or sibling AgentRun to end.

`projection_blocked/attachment_projection` remains a legal persisted state only for unfinished legacy v1 publication
work. Its completion/recovery path may transition only the still-pending Delivery that retains the exact legacy operation
association. It cannot attach itself to or delay Managed v2 messages, and it cannot revive a cancelled/failed/interrupted
terminal Delivery.

Cancellation still permits `cancelled + terminal + attempt=0`, never creates a synthetic attempt, and clears wait,
active attempt, pre-dispatch gate and projection association through the shared explicit/bulk transition helper.

## References

- [Message Delivery v7](message-delivery-v7.md)
- [Camp Attachment v6](camp-attachment-v6.md)
- [Camp Message Send v13](camp-message-send-v13.md)
