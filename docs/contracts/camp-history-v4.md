---
document_type: protocol-contract
contract: camp-history-v4
authority: agent-camp-history-retrieval
status: accepted
version: 4
last_updated: 2026-08-19
---

# Camp History Retrieval v4 Contract

This contract replaces [Camp History Retrieval v3](camp-history-v3.md) as the current entry. v4 preserves every v3
operation, canonical Camp identity, single-Camp target, Manifest/live authorization fence, Public A2A publication rule,
read mode, cursor, limit, ranking, attachment, body projection, exact self-write, replay and error boundary. It adds a
bundled-CLI shorthand for the common Timeline read without weakening the canonical Core input contract.

## CLI default completion

For `camp.read`, the bundled `rovai` CLI applies these defaults:

```json
{
  "mode": "timeline",
  "direction": "before",
  "limit": 20
}
```

The completion occurs after exactly one of direct arguments, JSON stdin/heredoc or `--input-file` has become one JSON
object and before canonical catalog Schema validation. All three input sources therefore have identical behavior.

- omitted `mode` becomes `timeline`;
- a resulting `timeline` mode receives `direction=before` and `limit=20` only when those fields are omitted;
- explicit `direction` and `limit` values win, while `cursor` has no default;
- explicit `item`, `around` or `thread` retains the v3 mode-specific contract; `thread.direction` remains required;
- explicit `timeline` receives the same omitted `direction` and `limit` completion as an omitted mode.

Thus `rovai camp read` reads the newest 20 visible messages from the authenticated current Camp, and adding
`--camp-id` changes only the single Camp target. `--direction after` begins with the oldest visible page. Pagination
continues by returning `nextCursor` as `cursor` with the same explicit or completed mode and direction.

## No mode inference

`messageId`, `bodyOffset`, `before`, `after` and other mode-scoped fields never select `item`, `around` or `thread`.
When mode is omitted they are validated against the completed Timeline input and fail with safe `fix_input` guidance
that requires an explicit message-anchored mode. A message ID remains a locator rather than a Camp scope or
authorization token.

The canonical Core `camp.read` Schema is unchanged: `mode` remains required, and `direction` remains required for
canonical `timeline` and `thread` inputs. The CLI sends a complete canonical object to Core; Router, authorization,
pagination, result projection, receipt and replay do not apply or remember transport shorthand.

## Help and compatibility

Exact `rovai camp read --help` presents `mode`, Timeline `direction` and Timeline `limit` as optional CLI fields with
their real defaults, while still teaching explicit message-anchored modes and direction/cursor semantics. The operation
catalog description states the same default and remains the non-discovery canonical description used by Transport
compatibility.

Camp History contract version is 4 and participates in the Built-in catalog compatibility digest through Transport
v17. There is no v3/v4 mixed binding or fallback. Existing v3 receipts replay their stored canonical results; v4 does
not rewrite persisted messages, cursors or receipts.

## References

- [Camp History Retrieval v3](camp-history-v3.md)
- [Built-in Tool Transport v17](builtin-tool-transport-v17.md)
- [Built-in Tool Runtime](../architecture/builtin-tool-runtime.md)
- [V1.14-D01](../versions/v1.14/decisions.md#v1-14-d01)
