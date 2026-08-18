---
document_type: protocol-contract
contract: camp-message-send-v4
authority: camp-public-a2a-send
status: accepted
version: 4
last_updated: 2026-08-12
---

# Camp Message Send v4 Contract

This contract completely replaces the current Agent-facing send contract in
[Camp Message Send v3](camp-message-send-v3.md). It preserves authenticated current-Run Camp scope,
explicit Agent addressing, caller return, Core-managed reply reference, atomic Delivery admission, durable replay
and compact output while adding Core-owned Current User Attention.

## 1. Closed Agent input

```json
{
  "body": "请确认方案；@agent_5 继续复核。",
  "to": ["agent_5"],
  "mentionUser": true,
  "taskId": "task_…"
}
```

- `body` is required, non-blank after trim, valid UTF-8, and at most 32 KiB. It is the
  `submittedBody`, not a second persisted message-body authority;
- `to` is optional, has at most 16 canonical Agent IDs, and is repeatable in CLI form;
- `mentionUser` is optional and defaults to `false`;
- `taskId` is optional and requires exactly one Effective Agent Recipient;
- the object is closed. `campId`, reply/return IDs, `userId`, `currentUserId`, `attentionUserId`,
  `mentionedUserId`, aliases, `me`, `user`, and compatibility fields are invalid;
- direct CLI flags are `--body`, repeatable `--to`, `--to-user`, optional `--task-id`, and the common
  `--input-file` input transport.

Core derives Camp, source AgentRun, execution epoch, reply reference and Current User identity. No Agent input can
select or copy those identities.

## 2. Two orthogonal addressing axes

### Effective Agent Recipients

Core parses exactly two Agent-addressing sources:

1. canonical Agent IDs in `to` / `--to`;
2. strict `@agent_<positive integer>` tokens in parseable `submittedBody` regions.

The union is validated atomically, deduplicated, sorted by opaque Agent ID UTF-8/ASCII bytes, and frozen. The same
ID through both sources creates one recipient and one Delivery while presentation metadata keeps source occurrences.
No valid source means zero Effective Agent Recipients, zero Deliveries, zero wakeups and zero A2A slots.

A reply relation, body prose, display-name match, Current User Mention, Default Lead, Missing-Send Recovery or
historical recipient set never adds an Agent recipient.

### Current User Attention

`mentionUser=true` means exactly:

```text
current_user_mention(userId="local_user")
  + camp_message_user_mention(recipientUserId="local_user")
```

It creates no Message Delivery, target AgentRun, wakeup or A2A slot. Agent input/output does not expose
`local_user`. `mentionUser=false` creates neither effect even when body text looks like `@you`, a user name,
`@local_user` or `@local-user`.

## 3. Structured content and projection

Core converts strict inline Agent tokens in `submittedBody` to `member_mention` segments. When `mentionUser=true`,
it then prepends:

```json
{"kind":"current_user_mention","userId":"local_user"}
```

The normalized ordered Structured Camp Message Content is the sole persisted content authority. Adjacent Text can
merge and empty Text can disappear; Mention occurrences and identities cannot be inferred, merged with lookalike
text, or removed. A leading Current User Mention projects as `@<current display name>` plus one U+0020 before
following body content. Display name fallback is localized `你` / `You`; the identity and content digest remain
`local_user`.

Renderer, exact/collection Camp reads, search, Context, plain-text Clipboard, notification summary and accessibility
derive from the same projected content. Canonical content digest includes segment kind and stable identity, not the
current display name. Full rules are in [Current User Attention v1](current-user-attention-v1.md).

## 4. Forward and caller return

Every Effective Agent Recipient is classified independently:

| recipient | edge kind | target Run lineage |
| --- | --- | --- |
| exact Immediate Caller | `return` | restore caller parent, root and depth |
| any other eligible Agent | `forward` | parent=source Run, root=current root, depth=current+1 |

Immediate Caller remains the persisted parent AgentRun and its owning Agent. Return creates a new continuation Run,
uses the normal recipient queue, and consumes one accepted-A2A responsibility; it never reopens the old Run.

Self is invalid. A forward target anywhere in the source lineage is `ancestor_cycle`; only the exact Immediate
Caller receives return classification. Forward depth cannot exceed 5. Return restores depth 0 through 4. Mixed
forward/return recipients are admitted atomically, and one invalid recipient rejects all message, notification,
Delivery and slot effects.

## 5. Core-managed Message Reply Reference

Every successful Agent-authored send sets:

```text
new CampMessage.reply_to_camp_message_id
  = current AgentRun.trigger_camp_message_id
```

For an A2A Run, Core also proves `trigger_message_delivery_id → message_id == trigger_camp_message_id`; the message
must be visible in the same Camp. Mismatch is an internal fail-closed invariant.

Reply is only a public thread/reference edge. It never affects Agent recipients, Current User Attention, Delivery,
notification or wakeup.

## 6. Task admission

If `taskId` is present, the count of Effective Agent Recipients after union and deduplication must equal exactly one.
`mentionUser` never counts toward or changes that cardinality.

```text
--task-id task_123 --to-user --body ...
  → message.task_recipient_ambiguous (0 Agent recipients)

--task-id task_123 --to-user --to agent_5 --body ...
  → continue with one-recipient Task validation
```

Two or more Agent recipients with a Task are equally ambiguous. All Task existence, Camp, lifecycle, responsibility
and one-time linked admission rules remain unchanged.

## 7. Atomic persistence and canonical result

Acceptance persists in one Core transaction:

- one public CampMessage with normalized Structured Content, content digest, frozen Agent recipient/presentation
  metadata, source operation identity and reply reference;
- exactly one `camp_message_user_mention` Notification when `mentionUser=true`, otherwise none;
- one Message Delivery v2 and one CampTurn slot reservation per Effective Agent Recipient;
- one send event, one notification event when applicable, one event per Delivery, receipt and durable command result.

The Notification source is this message ID and its recipient is `local_user`. If any write fails, nothing above is
committed. Delivery dispatch begins only after commit.

The canonical Core result remains:

```json
{
  "status": "accepted",
  "messageId": "message_…",
  "visibility": "camp_public",
  "campTurnId": "turn_…",
  "effectiveRecipients": ["agent_5"],
  "recipientPresentation": {},
  "recipientSetDigest": "sha256:…",
  "deliveryIds": ["delivery_…"],
  "allocatedAgentRunResponsibilities": 4
}
```

Agent Output v2 remains exactly `{messageId,effectiveRecipients}`. It has no `userMentioned`, notification ID or
user ID. Acceptance proves committed effects, not Delivery dispatch, Runtime start or completion.

## 8. Exact Camp read addressing

Each `camp.read(mode="item")` item includes:

```json
"addressing": {
  "effectiveAgentRecipients": ["agent_5"],
  "mentionsCurrentUser": true
}
```

Agent recipients come from the frozen message snapshot. `mentionsCurrentUser` derives from Structured Content, not
notification retention/read/clear state or body text. It is repeated for every body slice. Other read modes and
search snippets stay compact and require item read for exact addressing.

## 9. Idempotency, indeterminate outcome and errors

Durable invocation identity records and reuses Camp, source Run/epoch, canonical closed input, resolved
`local_user`, Structured Content, message/notification/Delivery IDs, result and receipt. Replay returns the original
effects. Changed input under the same identity is `builtin_tool.idempotency_conflict`; equal body under a new identity
is a new intentional send.

When a failure returns `confirm_outcome`:

- a returned authoritative message locator can be checked with exact Camp read addressing;
- without a locator, the Agent must not search/guess by body, infer failure from missing downstream completion, or
  resend. It reports uncertainty through the current Runtime outcome and stops this mutation.

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

Addressing errors list safe offending Agent sources. Current User identity is never an offending user-selectable
source.

## 10. Concise help

```text
rovai send
Publish one public Camp message. --to and inline @agent_id wake Agents; --to-user mentions the current user and creates an Inbox notification. Omit all addressing for a public-only update.

Examples:
  rovai send --body 'Status update'
  rovai send --to-user --body 'Please choose A or B'
  rovai send --to agent_5 --to-user --body 'Please review and decide'
```

Field descriptions:

```text
--to <AGENT_ID>  Optional Agent to wake; repeat for multiple recipients.
--to-user        Mention the current user and create an Inbox notification; creates no Agent delivery.
```

Use `rovai send --help` for this operation. `rovai task|camp|memory --help` are not valid family-level teaching
shortcuts.

## References

- [ADR-0165: Core-Owned Current-User Message Attention](../versions/v0.65/decisions.md#adr-0165)
- [Current User Attention v1](current-user-attention-v1.md)
- [Message Delivery v2](message-delivery-v2.md)
- [Built-in Tool Transport v7](builtin-tool-transport-v7.md)
- [Camp Message Send v3 (historical)](camp-message-send-v3.md)
- [Public A2A Message and Message Delivery architecture](../architecture/public-a2a-message-delivery.md)
