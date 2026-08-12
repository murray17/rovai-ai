---
document_type: protocol-contract
contract: message-delivery-v2
authority: message-delivery-lifecycle
status: accepted
version: 2
last_updated: 2026-08-12
---

# Message Delivery v2 Contract

Message Delivery v2 adds a frozen execution-edge classification and separates delivery causality from
the target AgentRun's call lineage. Queue, attempt, wait, retry/cancel, Context gate, settlement, and
interrupted recovery otherwise remain governed by
[Message Delivery v1](message-delivery-v1.md).

## 1. Frozen edge and lineage fields

Every accepted Delivery freezes:

```yaml
deliveryId: delivery_…
messageId: msg_…
campId: camp_…
recipientAgentId: agent_5
sourceAgentRunId: run_child
edgeKind: forward | return
targetParentAgentRunId: run_parent | null
returnToAgentRunId: run_caller | null
a2aRootAgentRunId: run_root
a2aDepth: 0..5
ancestorAgentIds: [agent_…]
replyToCampMessageId: msg_trigger
```

`sourceAgentRunId` is the causal author of this Delivery. `targetParentAgentRunId` is the direct parent
of the future target AgentRun's active call lineage. They are equal for `forward` but intentionally
differ for `return`. `returnToAgentRunId` identifies the exact caller Run whose lineage is restored.

The frozen snapshot schema is 2 and contains the same edge, target-parent, return-caller, root, depth,
ancestor, Task-admission, recipient, presentation, body, and reply-reference values. Dispatch, retry,
recovery, Context preflight, and AgentRun materialization consume these frozen values; none may reparse
the body or infer edge type from message author/reply metadata.

## 2. Lineage invariants

### Forward

```text
edgeKind = forward
targetParentAgentRunId = sourceAgentRunId
returnToAgentRunId = null
targetDepth = sourceDepth + 1, within 1..5
targetRoot = sourceRoot ?? sourceAgentRunId
ancestorAgentIds = source lineage Agent IDs
```

The recipient may not equal the source Agent or appear in `ancestorAgentIds`.

### Return

```text
edgeKind = return
returnToAgentRunId = source.a2a_parent_agent_run_id
recipientAgentId = owner(returnToAgentRunId)
targetParentAgentRunId = returnToAgentRunId.a2a_parent_agent_run_id
targetDepth = returnToAgentRunId.a2a_depth, within 0..4
targetRoot = returnToAgentRunId.a2a_root_agent_run_id ?? returnToAgentRunId
ancestorAgentIds = lineage(targetParentAgentRunId), or [] at depth 0
```

The source Run must be exactly one depth below the caller and share its root/CampTurn. No non-immediate
ancestor may be reclassified as return. The resulting continuation's own Immediate Caller derives from
its `targetParentAgentRunId`, so a later return pops one more call level instead of treating the return
source as a new parent.

## 3. Dispatch and Context

Both edge kinds enter the same recipient-scoped FIFO, attempt fence, wait conditions, Runtime checks,
Context Materialization Gate, retry/cancel policy, and settlement lifecycle. Both reserve one CampTurn
A2A slot. `target_busy` applies normally when the caller's conversation still has an active Run; the
target-run-ended event may pump the waiting return after that responsibility settles.

The target AgentRun is always new and has:

```text
invocation_kind = a2a
trigger_camp_message_id = Delivery.messageId
trigger_message_delivery_id = Delivery.id
a2a_parent_agent_run_id = Delivery.targetParentAgentRunId
a2a_root_agent_run_id = Delivery.a2aRootAgentRunId
a2a_depth = Delivery.a2aDepth
```

Current Input sender identity comes from the trigger CampMessage's authenticated
`source_agent_run_id`, not from `a2a_parent_agent_run_id`. Core validates that the Delivery's causal
source, target lineage, message, recipient, root, depth, and target Run agree before materialization.

Originating Public User Message discovery follows the target call lineage. A depth-0 return
continuation uses `returnToAgentRunId` to locate the original direct root Run without rewriting the
continuation's parent field.

## 4. Persistence, migration, and Read Side

Migration 76 rebuilds Message Delivery to add the v2 fields and allow return depth 0. Historical rows
are backfilled as:

```text
edgeKind = forward
targetParentAgentRunId = sourceAgentRunId
returnToAgentRunId = null
```

Their frozen snapshots are promoted to schema 2 with the same values. No historical row is inferred as
return from recipient identity or reply metadata.

CampSnapshot schema 28 exposes `edgeKind`, `targetParentAgentRunId`, and `returnToAgentRunId` per
Delivery so the Read Side can explain forward versus result-return execution without deriving it from
timeline order. Data Contract v0.62 / projection schema 31 owns the persisted shape.

## 5. Events and retry

`message_delivery.accepted`, `message_delivery.materialized`, and `agent_run.queued` include
`edgeKind`; return events also include `returnToAgentRunId`. These are audit projections of the frozen
Delivery, not independent edge authority.

An explicit retry creates another attempt for the same Delivery and therefore keeps exact edge kind,
causal source, return caller, target lineage, root, and depth. A retry must not turn a forward into a
return because Camp membership, reply reference, or current Runs changed.

## References

- [ADR-0163: Explicit Caller Return and Core-Managed Reply Reference](../adr/0163-explicit-caller-return-and-core-managed-reply-reference.md)
- [Camp Message Send v3](camp-message-send-v3.md)
- [Message Delivery v1](message-delivery-v1.md)
- [Public A2A Message and Message Delivery architecture](../architecture/public-a2a-message-delivery.md)
