---
document_type: protocol-contract
contract: gather-v4
authority: gather-lifecycle-and-barrier
status: accepted
version: 4
last_updated: 2026-08-26
---

# Gather v4 Contract

v4 replaces [Gather v3](gather-v3.md). The v3 request/capture projection, input schema, limits, Barrier CAS, result
selection and Completion FIFO remain. Acceptance additionally freezes the initiator's exact membership version, and
the Completion Delivery uses that same lifetime through [Message Delivery v7](message-delivery-v7.md).

Removing the initiator cancels every collecting/ready/completing Gather owned by that membership lifetime, its open
Items and pending Completion Delivery in the cutover transaction, and requests cancellation of exact running target
Runs. It does not route completion to a successor Default Lead and does not infer completion from dangling rows.
Only formal Item/Delivery/Run terminal settlement advances the associated membership reconciliation; terminal evidence
cannot publish after the frozen membership becomes inactive.

Removing a recipient follows the ordinary Delivery cutover and settles its current Item through the same typed Gather
terminal path. Re-adding either Agent creates a new lifetime and never revives the cancelled Gather or its Items.

## References

- [Gather v3](gather-v3.md)
- [Message Delivery v7](message-delivery-v7.md)
- [Camp Membership v1](camp-membership-v1.md)
- [Durable Gather architecture](../architecture/durable-gather-barrier.md)
