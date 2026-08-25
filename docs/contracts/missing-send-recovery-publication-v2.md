---
document_type: protocol-contract
contract: missing-send-recovery-publication-v2
authority: successful-agentrun-missing-send-publication
status: accepted
version: 2
last_updated: 2026-08-26
---

# Missing-Send Recovery Publication v2 Contract

v2 replaces [v1](missing-send-recovery-publication-v1.md). Adapter candidate boundaries, accepted-send detection,
recipient-free message shape, size limits, replay and commit-order race semantics remain.

Before publishing either ordinary Agent output or a Missing-Send candidate, Core must verify the source AgentRun's
frozen membership version still equals its current active Camp membership. Mismatch adds the closed decision:

```text
skipped_membership_fenced
```

The successful AgentRun and its terminal evidence remain authoritative and may settle Delivery/Gather/reconciliation;
the candidate body is not published, `finalCampMessageId` remains unset, and replay returns the stored decision without
retrying publication. A later ordinary add creates a new membership lifetime and cannot change this result.

## References

- [Missing-Send Recovery Publication v1](missing-send-recovery-publication-v1.md)
- [Camp Membership v1](camp-membership-v1.md)
- [Public A2A architecture](../architecture/public-a2a-message-delivery.md)
