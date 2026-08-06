---
document_type: adr
id: ADR-0108
title: "Discovery-Only Camp Message Search and Sequence-Paged Reads"
status: accepted
date: 2026-08-05
decision_scope: cross-version
source_version: v0.40
supersedes: []
superseded_by: null
---

# ADR-0108: Discovery-Only Camp Message Search and Sequence-Paged Reads

> [ADR-0129](0129-deterministic-bounded-raw-public-context-delivery.md) 删除其余 Camp Summary
> 生成、持久化和 Core 上下文组成能力；本文的四项原始 CampMessage 检索合同继续有效。

## Context

ADR-0051 introduced five model tools that separately search messages and summaries, read one
message, read a window, read a reply thread and read a summary. The split preserves safe bounded
reads, but it makes the model choose among several retrieval mechanics after every hit. Its
relevance-search cursor also suggests that a changing BM25 result set can be traversed as a stable
collection, even though inserts or visibility changes can reorder the set between calls.

Camp-owned summaries remain valuable for bounded Core context composition, but exposing both
summary bodies and original messages through model retrieval creates two readable representations
of the same public source history. Cross-Camp access under ADR-0106 makes that surface and its
authorization cost larger.

## Decision

The stable Team Tool Gateway exposes exactly four Camp history tools:

```text
camp.list
camp.search
history.search
camp.read
```

`camp.list` discovers other Camps by their frozen names. `camp.search` searches public message
bodies in the current Camp. `history.search` searches public message bodies across the other Camps
authorized by ADR-0106. These three operations return bounded Top-K results and never expose a
pagination cursor. A caller refines the query or enters raw reading instead of continuing an old
relevance rank. They may report that the Top-K was truncated, but do not compute an exact omitted
count: discovery is not a complete traversal or count API.

Full-text indexes may identify matching source rows, but relevance scores and corpus statistics
must be derived only after the authorized Camp set, Manifest boundary and date range have been
applied. A global FTS5 BM25 score is not valid because unauthorized Camp documents would influence
visible ordering even when their rows are filtered from the result.

Only original public CampMessage content is searchable and readable. Segment and Epoch Summaries
remain internal inputs to Core-owned context composition; they are not search hits or readable
model items. The Summary FTS index has no remaining reader and is removed without removing Summary
generation or range-based context composition. Search may internally use exact derived references
to improve ranking, but references, sender filters, Summary sources and sequence ranges are not
separate model query languages.

`camp.read` is the sole raw-read interface and has four modes:

- `item` slices one stable message body by Unicode-scalar offset;
- `around` returns one bounded, non-pageable neighborhood around a stable message anchor;
- `thread` resolves any visible message to its reply-tree root and pages within that tree;
- `timeline` pages the Camp's original message order.

Thread and timeline share one integer CampMessage sequence cursor. Explicit cursors are exclusive;
results remain ordered by sequence ascending. The cursor contains no Camp identity, content
identity, snapshot or authority. Every read supplies a Camp ID and is reauthorized independently.

Collection modes return bounded original-body prefixes so one long message cannot displace the
selected neighborhood or page. `item` is the continuation path for a long body. Historical
attachments expose bounded metadata only; internal paths, Runtime projections and attachment
content remain outside this interface.

Exact input fields, limits, cursor edges, response shapes and error codes are frozen by the source
version's [tool contract](../versions/v0.40/tool-contract.md). ADR-0106 owns cross-Camp membership,
Manifest and live-revocation semantics; this ADR owns the model-facing discovery-versus-reading
split.

This ADR locally replaces ADR-0051's five-tool catalog, model-readable Summary, relevance
pagination, discovery omitted-count requirement and window/thread continuation contracts.
ADR-0051's literal-query safety, short-query bounded fallback, source-message authority, tombstone
filtering and hard response budgets survive unless the v0.40 contract explicitly narrows them.

## Consequences

- The model has one path from discovery to evidence: Top-K message hit, stable ID read, then
  sequence-based continuation when needed.
- Relevance algorithms may change without pretending that offsets provide a stable traversal.
- Removing Summary from the model surface eliminates a second readable history authority while
  preserving Summary's Core context-composition value.
- Around, thread and timeline can return predictable sets even when individual messages are long;
  full depth costs explicit item reads.
- Historical file access is not silently granted by a message-read permission.
- Exact sender-only or arbitrary sequence-range search is unavailable until a demonstrated need
  justifies expanding the small query surface.

## Rejected Alternatives

- Keep five renamed tools: rejected because it preserves the model's post-search tool-selection
  burden without adding authority or information.
- Paginate BM25 or hybrid results by integer offset: rejected because document and visibility
  changes can duplicate or skip hits.
- Put an opaque snapshot and authorization capability inside search cursors: rejected because it
  couples relevance traversal to Run authority and duplicates ContextManifest.
- Return Summary and CampMessage as peer result kinds: rejected because original messages already
  provide stable source evidence and Summary remains an internal composition optimization.
- Make every read mode pageable: rejected because item uses body slicing and around is a bounded
  orientation view; only stable ordered collections need collection cursors.
- Return attachment storage paths: rejected because a message read must not become an ambient
  cross-Camp filesystem grant.

## References

- [v0.40 tool contract](../versions/v0.40/tool-contract.md)
- [ADR-0106: Agent-Bounded Cross-Camp Public History Retrieval](0106-agent-bounded-cross-camp-public-history-retrieval.md)
- [ADR-0051: Boundary-Capped Context Retrieval](0051-boundary-capped-context-retrieval.md)
- [ADR-0050: Camp-Shared Progressive Summaries](0050-camp-shared-progressive-summaries.md)
- [Domain terminology](../../CONTEXT.md)
