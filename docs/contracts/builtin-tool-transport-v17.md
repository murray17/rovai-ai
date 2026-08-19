---
document_type: contract
contract: builtin-tool-transport-v17
status: accepted
target_version: v1.14
last_updated: 2026-08-19
---

# Built-in Tool Transport v17

This contract replaces [Built-in Tool Transport v16](builtin-tool-transport-v16.md) as the current entry. v17 inherits
every v16 canonical Camp identity, LocalIpcEndpoint, IPC v2, Envelope/receipt/replay, process/lease, idempotency, Agent
Output v2, fifteen-command catalog, PublicOnly, Principal attention and progressive help boundary. It changes only the
bundled CLI semantics and catalog teaching for the `camp.read` Timeline shorthand defined by
[Camp History Retrieval v4](camp-history-v4.md).

```text
BUILTIN_TOOL_CONTRACT_VERSION = 17
BUILTIN_TOOL_CLI_COMMAND_VERSION = 17
Runtime capability = builtin_cli.transport.v17
fixed command count = 15
IPC protocol = 2; Envelope = 1; receipt = 1; Agent Output = 2
Camp History = 4; Context Formatter = 20; ContextManifest = 18
```

## `camp.read` CLI completion

After the CLI has parsed exactly one input source into one JSON object and before catalog Schema validation, it completes
an omitted `camp.read` mode as `timeline`, then completes omitted Timeline `direction` and `limit` as `before` and `20`.
Direct flags, JSON stdin/heredoc and `--input-file` use the same path. Explicit values win and `cursor` is never created.

Message-anchored fields do not cause mode inference. An omitted mode with fields that Timeline does not accept produces
targeted `builtin_tool.invalid_input` / `fix_input` guidance to choose `item`, `around` or `thread` explicitly. The CLI
continues to validate the completed object against the unchanged canonical Core catalog Schema before loading its
lease/context or sending IPC.

The catalog input and output Schemas, Core Router, authorization, pagination, Agent Output projection, receipt and replay
semantics remain unchanged. Only the CLI's accepted shorthand, exact help, operation description, Camp History contract
version and resulting catalog/compatibility digest move atomically to v17.

## Model-context boundary

This transport revision does not change Session Charter bytes, Bootstrap composition, Context Formatter 20,
ContextManifest 18, Dynamic Context or Runtime input delivery. The Charter continues to teach the stable CLI/help entry;
command-specific defaults remain owned by exact help, the operation catalog and `cli-operations`. No model-context
revision or Session rotation is introduced by v17.

## Clean break and replay

Current Runtime installation snapshots and Native Bindings must advertise `builtin_cli.transport.v17`; v16 capability or
Camp History v3 is incompatible before invocation. There is no v16/v17 dual catalog or downgrade. Already persisted
receipts replay their canonical result exactly and are not reinterpreted through CLI defaults.

## References

- [Built-in Tool Transport v16](builtin-tool-transport-v16.md)
- [Camp History Retrieval v4](camp-history-v4.md)
- [ContextManifest Evidence v18](context-manifest-evidence-v18.md)
- [V1.14-D01](../versions/v1.14/decisions.md#v1-14-d01)
