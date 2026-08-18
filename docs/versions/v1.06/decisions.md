---
document_type: version-decisions
version: v1.06
lifecycle: historical
last_updated: 2026-08-18
---

# v1.06 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0215](#adr-0215) | Unified Single-Camp History Target and Public Message Publication Boundary | `accepted` |

<!-- legacy-adr:begin id=ADR-0215 source-file-sha256=cc405443b138d427eae77dd2d7f9bcb673eb5cdc1b59608041f3f944fd5215b7 -->
<a id="adr-0215"></a>

## ADR-0215: Unified Single-Camp History Target and Public Message Publication Boundary

迁移时原路径：`docs/adr/0215-unified-single-camp-history-target-and-publication-boundary.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0215
title: Unified Single-Camp History Target and Public Message Publication Boundary
status: accepted
date: 2026-08-18
decision_scope: cross-version
source_version: v1.06
supersedes: []
intended_supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0215 -->
<a id="adr-0215-context"></a>
### Context

Camp history retrieval has two independent sources of semantic drift. First, `camp.search` is fixed to the current
Camp while `camp.read` always requires a Camp ID, even though both operations need the same current-versus-historical
Manifest and live-authorization decision. Callers that already know a historical Camp must fall back to multi-Camp
discovery, and callers reading the current Camp must repeat scope that the authenticated Run already owns.

Second, a public Camp message can be durably published by either an ordinary send or Public A2A. Historical queries
that recognize only the ordinary send event omit a public fact from search, exact read, reply traversal and frozen Camp
activity even though ADR-0130 requires the same message to enter the public timeline and Shared Conversation. Patching
individual queries cannot keep all consumers aligned or prevent duplicate rows if more than one publication event is
observed for one message.

<a id="adr-0215-decision"></a>
### Decision

The four-operation Camp history catalog remains `camp.list`, `camp.search`, `history.search` and `camp.read`, with these
stable responsibilities:

1. `camp.search` and every `camp.read` mode resolve exactly one shared Camp target. An omitted Camp ID resolves to the
   authenticated Run's current Camp; explicitly supplying that same ID is equivalent. A different Camp must be present
   in the Run's frozen ContextManifest history snapshot and must still pass active membership, no pending leave and
   present-profile checks. The target owns either the frozen current sequence boundary or the frozen global public
   boundary. IDs are format-validated before authorization, while nonexistent, unsnapshotted and unauthorized valid
   historical IDs are indistinguishable to the caller.
2. `history.search` remains the multi-Camp discovery operation. Omitting a Camp ID from `camp.search` never broadens it
   to history, and `camp.read` never discovers scope from a globally supplied message ID.
3. Historical public-message consumers resolve one publication fact per Camp message from either
   `camp_message.sent` or `camp_message.public_a2a_sent`. When more than one qualifying event exists, the earliest
   global sequence is the deterministic publication sequence. Search, exact and collection reads, reply root/parent
   traversal and frozen Camp activity apply the same global boundary to that resolved fact. Private delivery and
   non-public Runtime events never qualify, and existing event data is neither migrated nor backfilled.
4. The ADR-0170 exception remains confined to an exact item read of the current Run's command-result-proven committed
   self-write. It does not widen search, collection reads or any historical Camp target.

This decision locally replaces ADR-0108's current-Camp-only `camp.search` clause and its requirement that every
`camp.read` supply a Camp ID. ADR-0108's discovery-versus-traversal split, stable-ID reads, bounded Top-K search,
sequence cursors, source-message authority and attachment-path exclusion remain in force. ADR-0106 continues to own
the Manifest and live-revocation authorization boundary; ADR-0130 continues to own Public A2A public visibility.

<a id="adr-0215-consequences"></a>
### Consequences

- Known historical Camps have the same single-target search-to-read workflow as the current Camp without expanding
  Run authority or changing `history.search` aggregation.
- A valid authorized Camp with no matches returns an empty success, while an unavailable historical target returns a
  stable non-disclosing operation error.
- Public A2A messages no longer disappear from historical search, reply traversal or Camp activity, and duplicate
  publication events cannot duplicate message results.
- Historical SQL consumers must compose through the shared target and publication boundaries rather than authoring
  local event-type or authorization variants.
- The existing current-Run self-write receipt verification remains useful without becoming a live history feed.

<a id="adr-0215-rejected-alternatives"></a>
### Rejected Alternatives

- **Make omitted `camp.search` search every historical Camp.** This collapses single-target search into
  `history.search`, changes limits and output shape, and makes a narrow call unexpectedly broader.
- **Implement historical `camp.search` by calling `history.search`.** This couples two public operation contracts,
  repeats authorization/output projection and risks leaking multi-Camp metadata such as `campTitle`.
- **Infer Camp scope from `messageId`.** A locator is not authorization and a global lookup would reveal or probe
  cross-Camp identity.
- **Add Public A2A to only the body-search query.** Exact/reference search, item, thread, timeline and Camp snapshot
  activity would continue to disagree.
- **Join both raw publication event types directly.** Multiple qualifying events could duplicate a message and make
  ranking or global-boundary behavior nondeterministic.

<a id="adr-0215-references"></a>
### References

- [v1.06 version scope](README.md)
- [Camp History Retrieval v1](../../contracts/camp-history-v1.md)
- [ADR-0106: Agent-Bounded Cross-Camp Public History Retrieval](../v0.40/decisions.md#adr-0106)
- [ADR-0108: Discovery-Only Camp Message Search and Sequence-Paged Reads](../v0.40/decisions.md#adr-0108)
- [ADR-0130: Public A2A Messages and Unified Message Delivery](../v0.45/decisions.md#adr-0130)
- [ADR-0170: Current-Run Committed Self-Write Exact Read](../v0.67/decisions.md#adr-0170)
<!-- legacy-adr-body:end id=ADR-0215 -->
<!-- legacy-adr:end id=ADR-0215 -->
