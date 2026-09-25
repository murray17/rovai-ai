---
document_type: protocol-contract
contract: camp-history-v10
version: 10
status: accepted
authority: public-camp-history-read-scope
last_updated: 2026-09-24
---

# Camp History v10

v10 inherits [v9](camp-history-v9.md) authentication, public Camp scope, request shapes, live `camp.read` boundary, default 20 and explicit 1–100 page limit, complete pagination, attachment projection and quote-source validation. It changes explicit read/search visibility and withdrawn-message projection. New public Runs continue to use on-demand history; `RUN_INPUT` and `RUN_FACTS.historyHint` remain unchanged.

## Explicit read and search visibility

An authenticated Agent's `camp.read`, `camp.search` and `history.search` may return a published message while its `recall_state` is `recallable` or the viewing Agent still has a `waiting` Delivery. A read or search does not claim that Delivery, close recall, advance an accepted watermark or add the message to the current Run's frozen input. The Principal may still withdraw a local Composer message until the first target claim, subject to the existing message-version check. Previously returned tool results are not rewritten; subsequent calls use the current message state.

`camp.read` uses the selected extant public Camp's live sequence boundary at call time, including when that Camp differs from the calling Run's Camp. `camp.search` on the current Camp also remains live. Cross-Camp `camp.search`, `history.search` and `camp.list` retain the calling Run's frozen global publication boundary. IDs and cursors do not bypass Camp existence, publication, tombstone or these boundaries.

`camp.search` and `history.search` preserve their existing query, rank, snippet, limit and result schemas. They may match recallable or waiting messages within their boundary, but withdrawn messages are excluded from body, reference and structured Principal-mention candidates. A withdrawn marker is never searchable text.

## `camp.read` result items

Normal message item shapes remain unchanged. Timeline and thread normal items retain `messageId`, `sequence`, `authorType`, `authorId`, `anchorMessageId`, `createdAt`, `body`, `attachmentCount` and optional `quotes`. Exact-item normal results also retain `attachments`, attachment truncation fields and `addressing`.

After withdrawal, timeline and exact-item reads return an item with exactly these fields:

```json
{"messageId":"<id>","sequence":42,"withdrawn":true,"displayText":"Message withdrawn"}
```

The marker is generated from the current message state at read time. It occupies the message's original sequence and one page slot, so `limit`, `before`, `hasMore` and `nextCursor` continue to use sequence ordering. It has no `body`, author, timestamp, anchor, quote, attachment, addressing or recipient field. It does not restore erased content or change the withdrawal transaction. Exact ID outside the selected Camp or current read boundary returns `camp.read_unavailable`, even if a matching withdrawn row exists elsewhere.

A withdrawn thread anchor continues to return `message.withdrawn`. Withdrawal clears the reply association, so a withdrawn reply is not reinserted into its former thread. Mandatory `RUN_INPUT` selection and quote-source validation retain their existing recallable and waiting-Delivery suppression; a direct read or search result does not loosen those paths. New public Runs have no automatic `SHARED_CONVERSATION` projection under [ContextManifest v29](context-manifest-evidence-v29.md).
