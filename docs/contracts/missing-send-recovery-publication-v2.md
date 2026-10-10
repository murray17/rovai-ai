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

## Cline backend boundary (retired addition)

Superseded for Cline by [Runtime Launch v54](runtime-launch-and-verification-v54.md#cline-official-acp):
only ACP can create new candidates. The old boundary below is retained as passive historical data and is never eligible.

Cline Native Hub adds the internal candidate boundary `cline_hub_run_result`: only the full successful
`run.start` result text after observed native acceptance/model execution is eligible. It matches only
an AgentRun frozen to `cline-cli` + `cline-hub-v1`. The existing `acp_end_turn_assistant_suffix` matches
Cline only when the frozen protocol is `acp-v1`; missing/unknown protocol never crosses this fence.
Accepted builtin sends still suppress fallback, and all publication, membership and size checks above apply.

## References

- [Missing-Send Recovery Publication v1](missing-send-recovery-publication-v1.md)
- [Camp Membership v1](camp-membership-v1.md)
- [Public A2A architecture](../architecture/public-a2a-message-delivery.md)
