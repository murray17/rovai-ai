---
document_type: protocol-contract
contract: camp-history-v3
authority: agent-camp-history-retrieval
status: accepted
version: 3
last_updated: 2026-08-18
---

# Camp History Retrieval v3 Contract

Model-context revision 1 is confirmed. This contract replaces
[Camp History Retrieval v2](camp-history-v2.md) as the current entry. v3 preserves every v2 operation, single-Camp target,
Manifest/live authorization fence, Public A2A publication rule, mode, limit, ranking, attachment, body projection,
Unicode-scalar offset, exact self-write, replay and error boundary. It changes only Camp identity admission and output.

## Camp targets

Every explicit `campId` and every `history.search.campIds[]` entry must satisfy
[Camp Identity v1](camp-identity-v1.md). Omitted current-Camp targets continue to resolve from the authenticated AgentRun;
that resolved value is canonical by construction. Standard UUID, historical placeholder, uppercase or non-UUIDv7
`rvcamp_...` values fail as invalid input before authorization. Core never guesses, normalizes or queries an alias.

## Outputs

All Camp identity fields in `camp.list`, `camp.search`, `camp.read` and `history.search` use the same canonical value:

```json
{
  "campId": "rvcamp_01h47kvsy5fk1shh6w1g60eecf"
}
```

This applies to top-level read results, search items and Camp discovery snapshots. Message IDs, Camp sequence cursors,
Camp titles and last-visible activity remain separate fields and retain v2 semantics. A Camp ID is not a bearer cursor
or authorization token.

Agent message bodies continue to use `agent_v1` projection, including `CurrentUserMention → @Principal`; search
candidate selection and body offsets remain exactly v2.

## Replay and compatibility

Canonical Built-in results and receipts persist the `rvcamp_...` value and replay it byte-for-byte. Camp History contract
version is 3 and participates in the Built-in catalog/context compatibility digest through Transport v16. There is no v2
reader that accepts old Camp UUID targets and no output alias.

## References

- [Camp History Retrieval v2](camp-history-v2.md)
- [Camp Identity v1](camp-identity-v1.md)
- [ContextManifest Evidence v18](context-manifest-evidence-v18.md)
- [Built-in Tool Transport v16](builtin-tool-transport-v16.md)
- [ADR-0219 的迁移后决定正文](../versions/v1.10/decisions.md#adr-0219)
