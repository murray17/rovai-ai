---
document_type: protocol-contract
contract: camp-message-send
authority: camp-public-a2a-managed-attachment-v2-send
status: accepted
version: 14
last_updated: 2026-08-30
---

# Camp Message Send v14 Contract

v14 replaces [v13](camp-message-send-v13.md). Input shape, PublicOnly, Principal attention, Task/reply, Gather, fanout,
attachment-only payload, Managed v2 atomic commit and accepted result projection remain unchanged.

`--file` now accepts an existing Runtime-readable local file or directory outside the active Run roots. The CLI privately
snapshots external sources before the first IPC as specified in [Camp Attachment v7](camp-attachment-v7.md). Internal paths
are canonicalized without another payload copy. Relative paths still resolve against executionRoot. The CLI accepts absent
or empty `files` without inspecting attachment roots; ordinary body-only sends keep their existing behavior.

The same requestId, rewritten input and external snapshot are reused by every in-process transport retry. A retry never
returns to the original Runtime file. Core command replay continues to return recorded Message/Delivery identities without
reading sources. A new CLI invocation is a new request, not a recovery alias for a previous unknown outcome.

All source preparation must succeed before any send IPC. Invalid sources, quota failures, unsafe paths or failed promotion
produce no public message or Delivery. Local errors use the existing Agent error object shape:

```json
{
  "error": {
    "code": "builtin_tool.attachment_source_unavailable",
    "message": "attachment source is unavailable",
    "recovery": "fix_input",
    "details": { "attachmentIndex": 0 }
  }
}
```

`attachmentIndex` is zero-based and omitted when the failure belongs to shared staging rather than one attachment. Codes
use suffixes `source_unavailable`, `source_unreadable`, `unsupported_type`, `source_changed`, `limit_exceeded`, `invalid_path`
and `snapshot_unavailable` after `builtin_tool.attachment_`. Messages contain no original path or nested raw I/O error.
Outcome-indeterminate transport retains its existing exit code and recovery semantics; it is not converted into a safe retry.

The complete confirmed help/summary/example changes are recorded in
[v1.32 model-context revision 1](../versions/v1.32/model-context-change-send-external-files.md). Existing artifacts should be
passed directly; workspace/runTmp are preferred creation locations when selectable, not mandatory manual-copy destinations.
