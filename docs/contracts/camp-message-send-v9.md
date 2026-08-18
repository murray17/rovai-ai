---
document_type: protocol-contract
contract: camp-message-send-v9
authority: camp-public-a2a-send
status: accepted
version: 9
last_updated: 2026-08-16
---

# Camp Message Send v9 Contract

v9 replaces [Camp Message Send v8](camp-message-send-v8.md). The v8 closed input, canonical recipient and Structured
Content persistence, public rendering, Current User Attention, Task/reply admission, edge classification, exact durable
Gather capture identity and mixed-recipient atomicity remain.

A `gather_captured` recipient no longer reserves or increments ordinary accepted-A2A or AgentRun-responsibility
ledgers because the settled Delivery cannot materialize a Run. Before persisting any part of the send, Core counts
settled captures for the same Gather dispatch Delivery, exact source Run and source Run trigger generation. At 16, the
whole send is rejected with `message.execution_budget_exceeded` and
`details.limitScope=gather_captured_messages_per_item_generation`. The CampTurn lifecycle and deadline still gate the
send; non-captured recipients still consume the ordinary frozen budget.

All accepted captures remain public. Gather v2 selects only the last accepted capture from the current Item target Run
and active retry generation for Completion Input; older captures remain audit history. Public return evidence still
does not close the GatherItem.

## References

- [ADR-0195](../versions/v0.90/decisions.md#adr-0195)
- [Camp Message Send v8 (historical)](camp-message-send-v8.md)
- [Gather v2](gather-v2.md)
- [Message Delivery v4](message-delivery-v4.md)
