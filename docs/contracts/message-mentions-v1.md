---
document_type: protocol-contract
contract: message-mentions
version: 1
authority: model-message-target-metadata
status: accepted
last_updated: 2026-10-09
---

# Message Mentions v1

Only public batch `RUN_INPUT.messages[]` and normal `thread.read` items use this projection:

```ts
type MessageMention =
  | { id: AgentId; name: string }
  | { id: "user"; name?: never };
```

Every normal item requires `mentions: MessageMention[]`, including an empty array. Agent IDs pass Core's
existing canonical identity rules. They come from the message's persisted effective recipients, in that
stored order, deduplicated by ID. They include explicit routing targets without literal body mentions and
the saved All Members/default-addressing targets. Every viewer receives the complete list.

Names are resolved for the same projection, without an added @. Reuse names already resolved for the
body, query missing target IDs from retained profiles, and prefer the frozen default-recipient name when
present. Leaving/removed membership does not remove historical targets. Missing/invalid identity or an
empty name fails projection rather than silently dropping a saved target. No roster expansion, current
Lead lookup, body/name matching, persistent name cache or nickname history is introduced.

A structured Core CurrentUserMention appends exactly `{"id":"user"}` once, after all Agents.
User profile names, local_user and external platform identities are not emitted in that item.
Ordinary text, code and quotes do not create entries. Core does not read current-user-profile.json.

Agent entries describe Core-confirmed effective targets; the user entry describes structured attention.
Neither proves a target read, started or completed work. Reads acquire no responsibility and schedule
nothing. Message authors retain their existing local_user/Agent/external_principal identity.

Body projection, duplicate textual mentions, quotes, attachments, skills, time and paging stay unchanged.
Input retains its default-recipient prefix; read does not add one. Withdrawn read markers contain only
messageId, sequence, withdrawn:true and displayText:"Message withdrawn", without mentions.

The old independent input mentionsCurrentUser and read addressing fields are absent from these new normal
items. Internal structured facts, non-batch inputs/history, single_chat.history, search, send inputs/receipts,
UI, notifications, Delivery and channel ingress/egress/authorization retain their existing contracts.
