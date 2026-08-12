---
document_type: protocol-contract
contract: camp-message-send-v3
authority: camp-public-a2a-send
status: accepted
version: 3
last_updated: 2026-08-12
---

# Camp Message Send v3 Contract

This contract replaces the Agent-facing input, addressing, caller-return, and reply-reference clauses
of [Camp Message Send v2](camp-message-send-v2.md). The authenticated current Run remains the sole Camp
authority, durable command replay remains bound to the recorded Run/epoch, and one accepted request
still creates one public CampMessage plus zero or one Message Delivery per canonical recipient.

## 1. Closed Agent input

```json
{
  "body": "Review complete @agent_5",
  "to": ["agent_5"],
  "taskId": "task_…"
}
```

- `body` is required, non-empty, and at most 32 KiB;
- `to` is optional, repeatable in CLI form, unique in JSON form, and has at most 16 entries;
- `taskId` is optional and retains the one-effective-recipient admission rule;
- the object is closed. `campId`, `replyToCampMessageId`, `returnTo`, aliases, and compatibility
  translation are invalid input;
- CLI flags are `--body`, repeatable `--to`, optional `--task-id`, and `--input-file` transport input.

Core derives Camp, source AgentRun, execution epoch, and Message Reply Reference. Agent input never
selects or copies any of these identities.

## 2. Effective recipients

Core parses two explicit sources only:

1. canonical Agent IDs supplied through `to` / `--to`;
2. strict `@agent_<positive integer>` Addressing Tokens in parseable body regions.

The union is validated atomically, deduplicated, sorted by opaque Agent ID UTF-8/ASCII bytes, and
frozen. The same ID through both sources creates one recipient and one Delivery while presentation
metadata records both source occurrences. No `to` and no valid inline token means public-only: one
CampMessage, zero Deliveries, zero wakeups, and zero A2A slots.

A reply relation, body prose, display-name match, Default Lead, Missing-Send Recovery fallback, or
historical recipient set never adds a recipient.

## 3. Forward and caller return

Each canonical recipient is classified independently:

| recipient | edge kind | target Run lineage |
| --- | --- | --- |
| exact Immediate Caller | `return` | restore caller's parent, root, and depth |
| any other eligible Agent | `forward` | parent=source Run, root=current root, depth=current+1 |

An Immediate Caller is the current source AgentRun's persisted `a2a_parent_agent_run_id` and the Agent
owning that Run. A return freezes `returnToAgentRunId` as that exact caller Run. It creates and wakes a
new continuation AgentRun through the normal recipient queue and consumes one accepted-A2A/AgentRun
budget slot. It does not reopen or resume the old Run.

Self-target is always invalid. A forward target found anywhere in the source lineage is
`ancestor_cycle`; only the exact Immediate Caller receives return classification. Forward depth may
not exceed 5. A return can restore depth 0 through 4 and does not consume another logical depth.
Mixed forward and return recipients are allowed in one atomic send; a failure for any recipient rejects
the entire request before CampMessage or Delivery persistence.

## 4. Core-managed Message Reply Reference

For every successful Agent-authored send, Core sets:

```text
new CampMessage.reply_to_camp_message_id
  = current AgentRun.trigger_camp_message_id
```

For an A2A Run, Core also proves
`trigger_message_delivery_id → message_delivery.message_id == trigger_camp_message_id`. The trigger
message must be visible in the same Camp. Any mismatch is an internal fail-closed invariant, not an
Agent-correctable recipient error.

The reply field is a message-reference edge used by thread presentation and bounded public Context
reference closure. It never affects Effective Recipients, edge classification, Delivery dispatch, or
Agent wakeup.

## 5. Persistence and canonical result

Acceptance persists atomically:

- one CampMessage with public visibility, canonical recipients, presentation metadata, source
  operation identity, and Core-derived reply reference;
- one Message Delivery v2 per recipient with frozen `forward | return` classification and target
  lineage;
- one CampTurn slot reservation per Delivery;
- one domain event per Delivery plus one send event.

The canonical Core result remains:

```json
{
  "status": "accepted",
  "messageId": "msg_…",
  "visibility": "camp_public",
  "campTurnId": "turn_…",
  "effectiveRecipients": ["agent_5"],
  "recipientPresentation": {},
  "recipientSetDigest": "sha256:…",
  "deliveryIds": ["delivery_…"],
  "allocatedAgentRunResponsibilities": 4
}
```

Agent Output v2 keeps its compact `messageId` and `effectiveRecipients` projection. Acceptance or an
effective recipient does not prove dispatch, Runtime start, or completion.

## 6. Idempotency and errors

Durable replay is unchanged from v2: the invocation identity records and reuses Camp, source Run,
execution epoch, binding identity, tool-call identity, canonical input, result, and Delivery IDs.
Retrying with another request identity may create another message; reusing an identity with changed
input is `builtin_tool.idempotency_conflict`.

Stable Agent-facing errors are:

```text
builtin_tool.invalid_input            → fix_input
builtin_tool.run_not_bound            → stop
builtin_tool.idempotency_conflict     → stop
builtin_tool.outcome_indeterminate    → confirm_outcome
message.addressing_invalid            → fix_input
message.fanout_exceeded               → fix_input
message.a2a_depth_exhausted           → fix_input
message.task_recipient_ambiguous      → fix_input
message.invalid_task                  → fix_input
message.execution_budget_exceeded     → fix_input
```

`message.reply_invalid` is not part of v3 because reply identity is not Agent input. Addressing errors
list every offending `--to` or inline source with stable reason and require a new request identity.

## 7. Concise help

```text
rovai send
Publish one public Camp message. --to and inline @agent_id wake the addressed Agents; omit both for a public-only update. Addressing your direct caller returns the result and wakes it.

Examples:
  rovai send --body 'Status update'
  rovai send --to agent_5 --body 'Review complete'
```

The `--to` field description is: `Optional Agent to wake; repeat for multiple recipients.`

## References

- [ADR-0163: Explicit Caller Return and Core-Managed Reply Reference](../adr/0163-explicit-caller-return-and-core-managed-reply-reference.md)
- [Message Delivery v2](message-delivery-v2.md)
- [Built-in Tool Transport v6](builtin-tool-transport-v6.md)
- [Camp Message Send v2 (historical)](camp-message-send-v2.md)
- [Public A2A Message and Message Delivery architecture](../architecture/public-a2a-message-delivery.md)
