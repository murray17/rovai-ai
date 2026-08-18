---
document_type: protocol-contract
contract: camp-message-send-v7
authority: camp-public-a2a-send
status: accepted
version: 7
last_updated: 2026-08-14
---

# Camp Message Send v7 Contract

This contract completely replaces [Camp Message Send v6](camp-message-send-v6.md). It preserves v6's closed input,
authenticated Camp scope, three Agent-addressing sources, Current User Attention, caller return, canonical freeze,
atomic persistence, replay and compact output. v7 changes only display-name alias position: mutable presentation aliases
must lead an explicit logical line and no longer route from ordinary mid-line prose.

## 1. Closed Agent input

```json
{
  "body": "迁移背景与约束……\n\n@Alice 请分析这个迁移方案",
  "to": [],
  "mentionUser": false,
  "taskId": "task_…"
}
```

- `body` is required, non-blank after trim, valid UTF-8 and at most 32 KiB;
- `to` is optional, repeatable, has at most 16 canonical Agent IDs and never accepts display names;
- `mentionUser` is optional and defaults to `false`;
- `taskId` is optional and requires exactly one Effective Agent Recipient;
- the object is closed. Agent input cannot select Camp, sender, reply/return or Current User identity;
- CLI input remains `--body`, repeatable `--to`, `--to-user`, optional `--task-id`, or common `--input-file`.

Current User Attention remains governed by [Current User Attention v3](current-user-attention-v3.md) and is orthogonal
to every Agent-addressing source.

## 2. Effective Agent Recipients

Core parses exactly three sources:

1. canonical Agent IDs in `to` / `--to`;
2. canonical inline `@agent_<positive integer>` tokens in parseable body regions;
3. line-leading exact display-name aliases for eligible current Camp members.

The v7 display-name grammar is:

```text
<logical-line-start><optional whitespace>@<complete current display name><Unicode whitespace or end-of-body>
```

A logical line starts at body byte zero or immediately after `\n`. Every character between that start and `@` must be
Unicode whitespace; this permits ordinary indentation, tabs and the `\r` of CRLF. A Markdown list marker, quote marker,
word or punctuation before `@` makes it ordinary text. A trailing handoff therefore uses a dedicated final non-empty
line beginning with the alias. Merely appearing somewhere on the final line does not grant routing authority.

The position gate applies only to display-name aliases. Canonical inline `@agent_N` remains stable machine-facing
syntax and keeps v6's existing parseable-body positions.

For both inline forms, fenced code, inline code, URL tokens and escaped literals are excluded. Display-name matching is
case-sensitive and exact; punctuation is not a following boundary. The target must have an active CampMember row, no
pending leave and a present AgentProfile in the send transaction. Canonical syntax has precedence, the longest complete
display name wins and equal-length ambiguity yields no alias occurrence. Malformed reserved `@agent_…` remains an
addressing error and cannot fall back to a display name.

Core resolves accepted aliases to canonical Agent ID before validation, union, deduplication, sorting and freeze. The
same ID through multiple sources creates one recipient and one Delivery. No valid source means a public-only message,
zero Delivery, zero wakeup and zero A2A slots.

`--to` display names, mid-line display aliases, nickname/prefix/fuzzy/case-folded matching, Unicode similarity,
punctuation boundaries, cross-Camp lookup, reply prose, Default Lead and historical recipients never add an Agent.

## 3. Structured content and canonical identity

Each canonical token or accepted display alias occurrence becomes:

```json
{"kind":"member_mention","agentId":"agent_6"}
```

Display-name bytes never become identity. Structured Content is the persisted content authority; canonical content
digest, recipient snapshot, Delivery and output use Agent ID. Renderer, reads, search and Context project this content
and never reparse body text for routing.

## 4. Forward, return and reply

Each Effective Agent Recipient is classified independently:

| recipient | edge kind | target Run lineage |
| --- | --- | --- |
| exact Immediate Caller | `return` | restore caller parent, root and depth |
| any other eligible Agent | `forward` | parent=source Run, root=current root, depth=current+1 |

Self, non-immediate ancestors, fanout, depth, budget and membership guards remain atomic. Every successful send keeps
the Core-managed reply reference to the current AgentRun trigger. Reply metadata never derives a recipient.

## 5. Task admission

When `taskId` is present, the frozen Effective Agent Recipient set must contain exactly one canonical ID after all
sources are unioned and deduplicated. Current User Attention does not count. Existing Task admission rules are unchanged.

## 6. Atomic persistence and canonical result

One Core transaction persists the public CampMessage, normalized Structured Content, canonical recipient/presentation
snapshot, optional Current User notification, one Message Delivery v2 and CampTurn slot per recipient, events, receipt
and durable result. Any failure rolls back all effects; dispatch begins only after commit.

The canonical result remains:

```json
{
  "status": "accepted",
  "messageId": "message_…",
  "visibility": "camp_public",
  "campTurnId": "turn_…",
  "effectiveRecipients": ["agent_6"],
  "recipientPresentation": {},
  "recipientSetDigest": "sha256:…",
  "deliveryIds": ["delivery_…"],
  "allocatedAgentRunResponsibilities": 4
}
```

Agent Output v2 remains `{messageId,effectiveRecipients}`. The sender must inspect `effectiveRecipients`; `[]` means
the accepted message was public-only and no Agent was routed.

## 7. Exact reads, idempotency and errors

Exact Camp reads expose frozen canonical recipients and never reconstruct them from projected body. Durable invocation
identity replays the original resolved Structured Content and recipient set even after profile rename. Changed input
under the same identity remains `builtin_tool.idempotency_conflict`; a new identity resolves against current members.

Stable error codes remain unchanged. A syntactically valid display-name lookalike in a disallowed position is ordinary
text, not an addressing offender. Explicit `to` and malformed reserved canonical syntax retain structured errors.

## 8. Concise help

```text
rovai send
Use --to agent_N or canonical inline @agent_N for stable Agent routing. A display-name alias is accepted only as the
first non-whitespace token on a line and must be followed by whitespace or end-of-body. Put a trailing handoff on a
dedicated final line. Always inspect effectiveRecipients; [] means no Agent was routed.
```

`--to <AGENT_ID>` remains canonical-only and preferred for automation. Exact operation help remains the routine
authority; no family-level alias or Skill parser is added.

## References

- [ADR-0184: Line-Leading Display-Name Inline Addressing Alias](../versions/v0.76/decisions.md#adr-0184)
- [ADR-0182: Core-Resolved Current-Camp Display-Name Inline Addressing Alias](../versions/v0.75/decisions.md#adr-0182)
- [Current User Attention v3](current-user-attention-v3.md)
- [Message Delivery v2](message-delivery-v2.md)
- [Built-in Tool Transport v10](builtin-tool-transport-v10.md)
- [Camp Message Send v6 (historical)](camp-message-send-v6.md)
- [Public A2A Message and Message Delivery architecture](../architecture/public-a2a-message-delivery.md)
