---
document_type: protocol-contract
contract: camp-history-v2
authority: agent-camp-history-retrieval
status: accepted
version: 2
last_updated: 2026-08-18
---

# Camp History Retrieval v2 Contract

Model-context revision 1 is confirmed. This contract replaces
[Camp History Retrieval v1](camp-history-v1.md) as the current entry. v2 preserves every v1 operation responsibility, closed input/output shape, Camp target,
authorization, publication fence, limit, ranking, attachment, exact self-write and error rule. It changes only the
plain-text audience used by Agent-visible message bodies and the candidate path needed to search that projection.

## Agent message audience

All `camp.search`, `history.search` and `camp.read` message text is rendered from authoritative Structured Content with
the Agent audience. The only segment delta is:

```text
CurrentUserMention(local_user) → @Principal
```

MemberMention, AllMembersMention, SkillMention and Text keep their current segment-aware rendering. Human UI and the
persisted derived `camp_message.body`/FTS cache retain the Human audience (`@你` or its existing localized equivalent).
No stored Structured Content, content digest or Human cache is rewritten by this contract.

## Search

Search inputs, Top-K limits and output shapes remain v1. The Human body/FTS cache is only a candidate optimization;
every candidate is re-rendered before literal matching, ranking and snippet creation. If the query can match the fixed
`@Principal` token under the existing literal fold rules, Core forms one bounded candidate union from (a) the existing
FTS/body path and (b) authorized/boundary-visible messages whose Structured Content contains CurrentUserMention. The
union uses the existing deterministic recency/Camp/message tiebreaks and existing `limit * 8` body-candidate budget;
one extra row sets `searchIncomplete`, then the set is truncated before reprojection. Structured candidates that do not
match the complete literal query after Agent reprojection are discarded unless the existing exact-reference path
independently admits them.

Thus a copied Agent token is searchable even though Human FTS does not store it, without an unbounded scan or an FTS-
only early cutoff. The structured path obeys the same Camp target, date and public-publication fences and is not a new
authorization source.

Search results retain the exact closed item:

```json
{
  "campId": "camp-id",
  "messageId": "message-id",
  "sequence": 1,
  "authorType": "agent | user",
  "authorId": "identity",
  "replyToMessageId": null,
  "createdAt": "RFC3339",
  "snippet": "Agent-projected text",
  "campTitle": "history.search only"
}
```

`campTitle` remains absent from `camp.search`. `truncated` and `searchIncomplete` retain v1 semantics.

## Read bodies and offsets

All read modes retain v1 shapes. `camp.read item` applies `bodyOffset/bodyLimit` to Unicode scalar values in the complete
Agent-projected body. Its `bodyLength`, `bodyTruncated` and optional `nextBodyOffset` are therefore in the same Agent
text space. Around/thread/timeline compute their 0-based prefix and continuation offsets in that space too. A caller may
copy `nextBodyOffset` into a later item read without converting against Human `@你` length.

The compact collection item remains:

```json
{
  "messageId": "message-id",
  "sequence": 1,
  "authorType": "agent | user",
  "authorId": "identity",
  "replyToMessageId": null,
  "createdAt": "RFC3339",
  "body": "Agent-projected prefix",
  "bodyOffset": 0,
  "bodyLength": 42,
  "bodyTruncated": true,
  "nextBodyOffset": 10,
  "attachmentCount": 0
}
```

The exact item retains v1 attachments and addressing fields. Null fields remain present where v1 requires them;
optional continuation is null/absent exactly as frozen by the existing Agent output schema.

## Replay and evidence

Built-in Agent output uses these Agent-projected canonical results unchanged. Receipt/replay reuses the stored canonical
Envelope/result for that invocation; it cannot fall back to Human cache projection. Context paths separately freeze the
same audience through ContextManifest v17 `messageProjectionAudience=agent_v1` and audience-specific
`projectedBodyDigest`. Structured `contentDigest` remains audience-independent.

## References

- [ADR-0218](../versions/v1.07/decisions.md#adr-0218)
- [Camp History Retrieval v1 (accepted predecessor)](camp-history-v1.md)
- [ContextManifest Evidence v17](context-manifest-evidence-v17.md)
