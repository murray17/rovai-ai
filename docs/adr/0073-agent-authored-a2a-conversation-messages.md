---
document_type: adr
id: ADR-0073
title: Agent-Authored A2A Conversation Messages
status: accepted
date: 2026-07-30
decision_scope: cross-version
source_version: v0.24
supersedes: []
superseded_by: null
---

# ADR-0073: Agent-Authored A2A Conversation Messages

> [ADR-0091](0091-durable-member-calls-and-single-slot-a2a-resume.md) 将工具重命名为
> `team.call_member`，并以 ConversationInput 延后创建单槽 AgentRun。本文关于真实 Agent
> InboxMessage 的用户投影继续有效；Core Outcome 不创建 InboxMessage，也不冒充 Agent。

## Context

`team.post_message` is an authenticated action taken by one Agent toward another Agent. Core
already persists its body in an `InboxMessage`, derives the sender and recipient from trusted
runtime state, atomically delivers it to the recipient continuity, and queues the target
AgentRun.

The previous Camp timeline also synthesized `author_type='system'` CampMessages such as
“collaboration request delivered” and “collaboration result returned”. This made an Agent action
look like a system announcement, duplicated the meaningful request with delivery-state prose, and
allowed private A2A boundaries to enter Camp public-message sequence, FTS, summaries, and later
shared context. Labels such as “executing” also attributed Core-observed target state to the
sender even though the sender did not make that claim. A returned reply already has its own
author and body and does not need a second “returned” announcement.

The user still needs one coherent conversation view that shows who said what to whom without
turning every user-visible record into a CampMessage.

## Decision

### InboxMessage owns A2A message content

A successfully delivered `team.post_message` body remains authoritative `InboxMessage` content.
The user-facing Camp conversation projects that record exactly once as an Agent-authored directed
message:

```text
<sender name> → @<recipient name>
<body>
```

Sender and recipient identities come from the persisted AgentProfile relationships, never from
model-authored display text. The projection uses the sender's ordinary Agent identity treatment;
it is not a system message or a structured status card.

This user-visible projection does not convert the body into CampMessage. The A2A body remains
excluded from Camp public-message FTS, shared summaries, public context delivery, and unrelated
Agents' readable history. “Visible to the local user” and “public to every Agent” remain separate
authority decisions.

### Successful lifecycle state is not conversation content

Core must not synthesize happy-path CampMessages for A2A request acceptance, delivery, target
execution, result receipt, or return. In particular, the conversation does not add labels such as
“已送达”, “执行中”, or “已返回”.

Delivery and execution state remain authoritative InboxMessage, AgentRun, event-log, Activity,
and Audit facts. Those diagnostic surfaces may report current Core state, but they are not
statements authored by the sender and do not occupy the conversation as messages.

An Agent reply is represented by the reply action and its own authored content. Core never
synthesizes a second message to announce that the reply returned. A rejected `team.post_message`
creates no InboxMessage and therefore no conversation message.

### Cross-source ordering is persisted

The Camp conversation merges user/public CampMessages and delivered A2A InboxMessages using their
persisted domain-event global sequence when both records provide one. Persisted creation time and
stable identity are fallback ordering keys for legacy records. Renderer arrival time, role, and
visual grouping never reorder messages.

## Consequences

- Users see the real collaboration request once, with its actual sender and directed recipient.
- Sender intent is no longer conflated with Core-observed delivery or target execution state.
- A2A content can appear in the local user's conversation without becoming public Agent context.
- The Camp Snapshot must expose stable cross-source ordering evidence for CampMessage and
  InboxMessage projections.
- Existing synthetic `a2a-state` CampMessages must be hidden or tombstoned while their underlying
  audit events remain available.
- Activity and Audit remain the places for delivery failures, target Run state, correlation, and
  recovery evidence.

## Rejected Alternatives

### Keep A2A request and result as system CampMessages

Rejected because it misattributes an Agent action, duplicates authored content with lifecycle
prose, and leaks a private collaboration boundary into public-message infrastructure.

### Add “delivered / executing / returned” badges to each directed message

Rejected because the sender did not author those claims, the state can change independently, and
the reply itself is sufficient evidence that a reply exists.

### Copy InboxMessage bodies into CampMessage for rendering convenience

Rejected because CampMessage participates in public summaries, search, and shared Agent context.
Presentation convenience cannot broaden the A2A body's authority.

### Keep A2A bodies only in Activity

Rejected because Activity is a diagnostic lifecycle view rather than the Camp's readable human
conversation, and it obscures who actually said what to whom.

## References

- [v0.24 Arctic Dawn V3](../versions/v0.24/README.md)
- [ADR-0014: Stable Team Tool Gateway v2](0014-stable-team-tool-gateway-v2.md)
- [ADR-0013: Managed Content and Read Side v2](0013-managed-content-and-read-side-v2.md)
- [ADR-0061: Durable User-Visible and Agent-Inaccessible Execution Evidence](0061-durable-agent-inaccessible-execution-evidence.md)
