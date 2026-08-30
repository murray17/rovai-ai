---
document_type: contract
contract: builtin-tool-transport-v21
status: accepted
target_version: v1.32
last_updated: 2026-08-30
---

# Built-in Tool Transport v21

v21 replaces [v20](builtin-tool-transport-v20.md) for new invocations. It adds lease-owned attachment roots to the private
CLI context and changes Send source preparation/help. IPC framing, authentication fields, Envelope, receipt, replay,
fifteen-operation catalog, Agent output and non-Send command semantics remain unchanged.

```text
BUILTIN_TOOL_CONTRACT_VERSION = 21
BUILTIN_TOOL_CLI_COMMAND_VERSION = 21
Runtime capability = builtin_cli.transport.v21
Camp Message Send = 14
IPC protocol = 2; Envelope = 1; receipt = 1; Agent Output = 2
```

## Private context

The existing optional `lease` field, when active, has exactly these required data fields:

```json
{
  "leaseId": "opaque-current-lease-id",
  "leaseGeneration": 1,
  "leaseToken": "opaque-current-lease-token",
  "executionRoot": "/absolute/current-agent-run-workspace",
  "runTmp": "/absolute/current-process/run-tmp"
}
```

Core writes executionRoot from the current AgentRun workspace and runTmp from the exact configured/reset lease root before
publishing active context. Both paths are absolute. Authentication over IPC remains the original process/lease credentials;
Core never accepts these context paths as caller-supplied authorization roots. CLI versions fail closed on incompatible context.
The process-stable `ROVAI_RUN_TMP` environment variable and each Adapter's exact native root admission remain unchanged.

## Send preparation and compatibility

The CLI parses/validates input, loads/authenticates context, creates requestId once, prepares external attachment snapshots,
rewrites files, then builds/serializes one request for its transport retry loop. Missing/empty files do not require snapshot
work. Every retry reuses the same external bytes and paths. Failures before IPC clean owned staging; uncertain dispatch keeps
snapshots for lease cleanup. Lease retirement cleanup handles frozen directories and never follows source links.

Contract/CLI/capability versions and catalog digest move together. Their existing Binding compatibility digest invalidates
old bindings for new execution; no old/new dual stack is introduced. Bootstrap text, Session Charter revision 2, Dynamic
Context, ContextManifest, Runtime Input Delivery evidence and formatter/profile versions remain unchanged. Existing receipts,
committed messages and historical terminal evidence are not rewritten; there is no database migration.

## References

- [Camp Attachment v7](camp-attachment-v7.md)
- [Camp Message Send v14](camp-message-send-v14.md)
- [Confirmed model-context revision 1](../versions/v1.32/model-context-change-send-external-files.md)
- [Built-in Tool Runtime](../architecture/builtin-tool-runtime.md)
