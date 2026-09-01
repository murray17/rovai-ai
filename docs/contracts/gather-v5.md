---
document_type: protocol-contract
contract: gather-v5
authority: gather-agent-visible-recipient-teaching
status: accepted
version: 5
last_updated: 2026-09-01
---

# Gather v5 Contract

v5 replaces [Gather v4](gather-v4.md) only for Agent-visible schema descriptions and CLI help. The v4 request/capture
projection, limits, Barrier CAS, result selection, Completion FIFO, membership lifetime and cancellation semantics
remain unchanged. Canonical `--to` is the only recommended Gather-recipient authoring route.

## Agent-visible teaching

The `body` input schema description is exactly:

```text
One shared public topic for every Gather recipient.
```

The `to` input schema description is exactly:

```text
Canonical Agent IDs to gather from. Effective recipients are frozen in canonical byte order.
```

The `rovai gather --to` CLI help is exactly:

```text
Canonical member target; repeat for each additional distinct member.
```

The input schema retains `uniqueItems: true`: repeating `--to` for different canonical members is valid, while
repeating the same member is rejected by schema validation before sending. Core still merges valid explicit targets
with any existing compatibility occurrences, canonicalizes, sorts, deduplicates and freezes Effective Recipients.
No parser, recipient admission, Item, return capture, Delivery, fanout or lifecycle behavior changes.

## Version and evidence boundaries

The changed Gather schema descriptions rotate `builtin_tool_catalog_digest`; CLI-only help does not independently
enter that digest. Built-in Tool Transport v21, CLI/capability versions, input/output JSON shape, error codes, IPC,
Envelope, receipt and replay remain unchanged. There is no database migration, history rewrite or parser migration.

Implementation authorization:
[confirmed revision 1](../versions/v1.37/model-context-change-inline-addressing-teaching.md).
