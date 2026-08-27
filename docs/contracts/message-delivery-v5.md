---
document_type: protocol-contract
contract: message-delivery-v5
authority: message-delivery-lifecycle
status: accepted
version: 5
last_updated: 2026-08-20
---

# Message Delivery v5 Contract

v5 replaces [v4](message-delivery-v4.md). The closed public/captured/completion union, recipient FIFO, attempt fence,
wait conditions, explicit retry/cancel, Gather settlement and generation-strict capture remain. v5 adds one pre-dispatch
attachment projection gate.

An addressed message with attachment publication creates its Delivery with:

```text
dispatchPhase = projection_blocked
preDispatchGate = attachment_projection
projectionOperationId = <required operation>
dispatchAttemptCount = 0
activeAttempt = null
```

This Delivery occupies recipient FIFO; later Deliveries cannot overtake it. It has not attempted dispatch, is not
`interrupted_before_dispatch`, and is not eligible for ordinary pump events. Projection success atomically CASes the gate
to the ordinary `never_attempted` phase and explicitly triggers the recipient Dispatch Pump. Recovery completion uses the
same transition and trigger.

Recoverable projection failure retains the gate. Terminal projection failure uses existing terminal settlement to set
`status=failed`, `reason=attachment_projection_failed`, with no AgentRun or attempt. Retry cannot reinterpret the failed
attachment; a new public Send is required. Cancel remains explicit and preserves the public message/attachment facts.

## References

- [Message Delivery v4](message-delivery-v4.md)
- [Camp Published Attachment View v4](camp-published-attachment-view-v4.md)
- [Public A2A architecture](../architecture/public-a2a-message-delivery.md)
