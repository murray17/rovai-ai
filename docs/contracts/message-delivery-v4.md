---
document_type: protocol-contract
contract: message-delivery-v4
authority: message-delivery-lifecycle
status: accepted
version: 4
last_updated: 2026-08-16
---

# Message Delivery v4 Contract

v4 replaces [Message Delivery v3](message-delivery-v3.md). The v3 persisted discriminated union, public/captured/
completion variants, recipient FIFO, attempt fence, wait conditions, explicit retry/cancel, generation-aware Run
materialization, Gather settlement and Completion single-materialization CAS remain.

For a captured return, `gatherDispatchDeliveryId`, `sourceAgentRunId` and the source Run's
`triggerDeliveryGeneration` form the durable result generation. Capture admission consumes no ordinary accepted-A2A
or Run responsibility and is bounded independently to 16 settled Deliveries per exact result generation. Historical
captured Deliveries are immutable public evidence.

Barrier projection is generation-strict. A v2 Completion Item loads `activeRetryGeneration` and may select a captured
Delivery only when all of these hold:

```text
captured.gatherDispatchDeliveryId = item.dispatchDeliveryId
captured.sourceAgentRunId = item.targetAgentRunId
sourceRun.triggerMessageDeliveryId = item.dispatchDeliveryId
sourceRun.triggerDeliveryGeneration = item.activeRetryGeneration
captured.dispatchDisposition = gather_captured
captured.status = settled
```

It selects the final eligible CampMessage by descending sequence and stable message identity, at most one. A retry
changes the Item's active generation and target pointer but never deletes prior Runs, Deliveries or messages; those
prior facts therefore cannot enter the new generation's mandatory Completion Input.

## References

- [ADR-0195](../adr/0195-generation-scoped-last-gather-return.md)
- [Message Delivery v3 (historical)](message-delivery-v3.md)
- [Gather v2](gather-v2.md)
- [Public A2A architecture](../architecture/public-a2a-message-delivery.md)
