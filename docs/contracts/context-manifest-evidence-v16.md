---
document_type: protocol-contract
contract: context-manifest-evidence-v16
authority: agent-run-context-evidence
status: accepted
version: 16
last_updated: 2026-08-17
---

# ContextManifest Evidence v16 Contract

v16 replaces [ContextManifest Evidence v15](context-manifest-evidence-v15.md) and requires AgentRun Context
Formatter v18. Context Delivery Profile v3 selection/order/budgets, Bootstrap v3/Formatter v3, Shared Conversation,
Run Facts v1, Gather Completion Input v2, exact Dynamic Context bytes and Runtime Input Delivery ACK authority remain
unchanged.

## Selection source evidence

Every AgentRun stores non-null `skill_selection_snapshot_json` and `skill_selection_snapshot_digest` using
[Current Input Skill Links v1](current-input-skill-links-v1.md). Direct user Runs freeze the per-recipient send-time
eligibility in the send transaction; all other and migrated terminal Runs use the versioned empty snapshot. The
digest is canonical JSON SHA-256 as 64 lowercase hex without a prefix.

ContextManifest v16 keeps existing `skill_exposure_json` / `skill_exposure_digest` and adds non-null:

```text
current_input_skill_resolution_json
current_input_skill_resolution_digest
```

The resolution must reference exactly the AgentRun selection digest and the Manifest Exposure digest. It has one
ordered entry for every selection, including omitted selections:

```json
{
  "schemaVersion": 1,
  "selectionSnapshotDigest": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "skillExposureDigest": "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  "entries": [
    {
      "skillId": "skill-123",
      "nameAtSend": "review-pr",
      "firstSegmentIndex": 4,
      "eligibleAtSend": true,
      "runAvailability": {
        "state": "present",
        "active": true,
        "enabled": true,
        "name": "review-pr",
        "matchingGroupKeys": ["codex"]
      },
      "outcome": "included",
      "path": "/repo/.codex/skills/review-pr/SKILL.md",
      "revisionId": "revision-456",
      "contentDigest": "sha256:content",
      "groupKey": "codex"
    }
  ]
}
```

`runAvailability` is either `{"state":"missing"}` or the complete present shape from the link contract. An
included entry requires path/revisionId/contentDigest/groupKey, optional deliveredViaGroupKey, and no reason. An
omitted entry requires reason and no path/revisionId/contentDigest/groupKey/deliveredViaGroupKey; it copies optional
`sendOmissionReason` only when the send snapshot was ineligible.

Allowed resolution reasons are:

```text
not_eligible_at_send
missing_at_start
inactive_at_start
disabled_at_start
name_mismatch_at_start
runtime_group_unassigned_at_start
exposure_missing
exposure_name_mismatch
exposure_not_ready
exposure_group_incompatible
skill_file_unavailable
```

The resolution digest uses the same unprefixed canonical JSON digest. Skill Revision content digest and rendered
payload digest retain their existing formats. Empty selection still produces a versioned resolution with empty
entries, both source digests, and its own digest.

## Projection and authority

Formatter v18 may project only included resolution entries as `CURRENT_INPUT.skills[{name,path}]`. The existing
rendered payload blob/digest remains the complete proof of exact model-visible bytes; resolution and Exposure digests
cannot replace it.

Selection/availability are Context Source State, `CURRENT_INPUT.skills` is Model Context Projection, and
selection/Exposure/resolution/rendered bytes are Context Projection Evidence. Runtime Input Delivery continues to
bind Manifest, epoch and Native Binding generation; accepted ACK does not prove Skill load or model understanding.

## Recovery and clean break

New manifests require Formatter v18 and resolution evidence. Migration 91 rebuilds ContextManifest with
`CHECK(formatter_version = 18)`, removes incompatible Manifest/Delivery/Bootstrap/Binding/Session and non-terminal
technical state, and preserves Camp, Message, Structured Content, Attachment, Task, terminal execution and monitoring
business history. Migrated terminal Runs receive an empty selection snapshot; old Slash Text is never upgraded.

There is no Formatter v17/Manifest v15 reader, alias, inferred backfill or dual write. Active Run recovery with a v16
Manifest reuses the frozen payload, availability, resolution and Exposure byte-for-byte.

## References

- [ADR-0203](../adr/0203-structured-current-input-skill-links.md)
- [Current Input Skill Links v1](current-input-skill-links-v1.md)
- [ContextManifest Evidence v15 (historical)](context-manifest-evidence-v15.md)
- [Context Delivery Profile v3](context-delivery-profile-v3.md)
- [Run Facts v1](run-facts-v1.md)
