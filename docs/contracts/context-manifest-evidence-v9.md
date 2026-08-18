---
document_type: interface-contract
contract: context-manifest-evidence
version: 9
authority: agentrun-dynamic-context-projection-evidence
status: accepted
last_updated: 2026-08-09
---

# ContextManifest Evidence v9

ContextManifest v9 freezes the Dynamic Context model bytes/digest and the machine evidence needed to explain its
selection. It does not replace Context Source State, Bootstrap Evidence, Runtime Input Delivery Evidence, or domain
authorization. Selection and budget values remain owned by Context Delivery Profile v2; model field rendering
remains owned by Context Formatter v11.

## Omission evidence

Whole history excluded only by the 15-message window uses a bounded aggregate:

```json
{
  "kind": "public_history",
  "reason": "max_public_messages",
  "count": 985,
  "sequenceStart": 16,
  "sequenceEnd": 1000
}
```

It MUST omit `messageIds`. The sequence envelope may contain gaps and is not executable tool input.

Bounded candidate omissions retain exact IDs:

```json
{
  "kind": "public_history",
  "messageIds": ["message-123"],
  "reason": "history_budget"
}
```

Allowed exact reasons are `history_budget`, `runtime_payload_budget`, `max_reference_chain`,
`parent_unavailable`, `cycle`, and `tombstone`; `kind` remains `public_history` or `reference_closure` as applicable.
An exact entry MUST omit `count`, `sequenceStart`, and `sequenceEnd`.

The model-visible `omittedMessages` aggregate remains separate from these machine entries. It contains the total
omitted count, minimum/maximum sequence envelope, and navigation hint, and is never an authorization token.

## Unchanged evidence and delivery authority

ContextManifest continues to freeze selected source references, content/attachment digests, truncation facts,
reference distance, exact rendered Dynamic Context bytes/digest, complete Collaboration State v2 digest,
`collaborationStateIncluded`, and exact Run Notice payload bytes/digest. Runtime Input Delivery independently binds
the Manifest to an execution epoch and Native Binding generation. Only an `accepted` Runtime Input Delivery advances
Conversation watermarks; prepared, failed, `not_accepted`, and `delivery_unknown` inputs do not.

## Version cutover

ContextManifest v9 is current-only. Migration 69 deletes v8 technical context/delivery evidence and resets Binding
and Native Session watermarks while preserving completed business history. There is no v8/v9 union, nullable shim,
or legacy parser.

Decision rationale: [ADR-0149](../versions/v0.52/decisions.md#adr-0149).
