---
document_type: contract
contract: context-manifest-evidence-v12
status: accepted
target_version: v0.65
last_updated: 2026-08-12
---

# ContextManifest Evidence v12

v12 replaces [ContextManifest Evidence v11](context-manifest-evidence-v11.md) as the current recovery and evidence
reader. It preserves Profile v3 selection, self-active Task empty/omission semantics, public-history reference closure,
Collaboration State, Run Notice, attachment, Skill/MCP and Bootstrap evidence while adding an explicit Current User
Mention fact to every model-visible Camp message.

## Model message projection

Context Formatter v14 uses the same closed field on Current Input, originating public user message, reference closure
and recent messages:

```json
{
  "messageId": "message_123",
  "body": "@You Please choose A or B.",
  "mentionsCurrentUser": true
}
```

The field is always present for a CampMessage. `true` derives only from an authoritative
`current_user_mention(local_user)` Structured Content segment; `false` is explicit and is never inferred from body
text. ConversationMessage compatibility input that has no Structured Camp Message Content projects `false`.

All existing sender, sequence, reply, attachment, truncation and continuation fields retain their v11 meaning.
`body` is the projected Structured Content slice. A Mention in a truncated-away body region still yields
`mentionsCurrentUser=true`, because the boolean describes the whole message rather than the current slice.

## Message projection evidence

Every included Camp message evidence entry adds:

```json
{
  "contentDigest": "sha256:…",
  "projectedBodyDigest": "sha256:…",
  "mentionsCurrentUser": true
}
```

`contentDigest` verifies authoritative Structured Content including the stable `local_user` segment.
`projectedBodyDigest` verifies the exact body slice rendered into Formatter v14. The boolean must equal the full
Structured Content fact. Notification existence, read/clear/retention, display-name changes after materialization and
plain-text lookalikes cannot change it.

ContextManifest freezes Formatter v14 exact bytes and all v12 evidence inside the existing direct/A2A
materialization critical section. Runtime Input Delivery binds those bytes to AgentRun epoch and Native Binding as
before. Recovery reuses the original bytes, projected display name and boolean without rereading current profile,
message, notification or locale state.

## Existing v11 semantics retained

- Profile v3 still selects at most 15 public messages, 3 reference-chain messages and 8 self-active Tasks under the
  existing public-history-first budget order;
- authoritative empty self-active candidates still render `{"tasks":[]}` with `included:true`; all-candidate budget
  omission still uses `included:false` and positive aggregate omission count;
- Collaboration State digest/inclusion, attachment references, Run Notices, Skill/MCP exposure, Bootstrap references
  and accepted-ACK boundaries are unchanged;
- evidence never repeats full message body or Notification details, and grants no read, message, user or mutation
  authority.

## Current-only migration

v12 requires Context Formatter v14. v0.65 clean break removes incompatible ContextManifest, Runtime Input Delivery,
Bootstrap technical evidence and frozen A2A delivery context; fences affected non-terminal execution; and resets
Native Binding context markers. CampMessage Structured Content, Task, Memory and other compatible business facts are
retained or rebuilt according to the v0.65 data migration. No v11/v12 dual reader, nullable boolean shim or
body-lookalike fallback remains.

## References

- [Current User Attention v1](current-user-attention-v1.md)
- [ContextManifest Evidence v11 (historical)](context-manifest-evidence-v11.md)
- [Context Delivery Profile v3](context-delivery-profile-v3.md)
- [ADR-0165](../versions/v0.65/decisions.md#adr-0165)
- [Built-in Tool Runtime architecture](../architecture/builtin-tool-runtime.md)
