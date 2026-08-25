---
document_type: protocol-contract
contract: message-delivery-v6
authority: message-delivery-lifecycle
status: accepted
version: 6
last_updated: 2026-08-26
---

# Message Delivery v6 Contract

v6 replaces [v5](message-delivery-v5.md). Its closed delivery union, FIFO, attempts, projection gate, wait conditions,
retry/cancel and settlement remain. Every newly admitted recipient Delivery additionally freezes:

```text
recipientMembershipVersionAtAdmission: integer >= 1
```

Dispatch, materialization and explicit retry require that the recipient is present and has an active Camp membership
whose exact version equals the frozen value. Absence, leave or a later ordinary add with a new version cannot be treated
as temporary readiness; the old Delivery settles terminally with the membership fence reason, and retry cannot revive it.

Terminal evidence may settle an already running attempt through the narrow terminal path, but any public output from
that Run remains subject to [Missing-Send Recovery Publication v2](missing-send-recovery-publication-v2.md) and the
general publication fence.

## References

- [Message Delivery v5](message-delivery-v5.md)
- [Camp Membership v1](camp-membership-v1.md)
- [Public A2A architecture](../architecture/public-a2a-message-delivery.md)
