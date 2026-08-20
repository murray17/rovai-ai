---
document_type: contract
contract: builtin-tool-transport-v19
status: accepted
target_version: v1.19
last_updated: 2026-08-20
---

# Built-in Tool Transport v19

v19 replaces [v18](builtin-tool-transport-v18.md). IPC v2, Envelope/receipt/replay, Agent Output v2, fifteen-command count,
Charter and every non-Send command remain unchanged. It upgrades `camp.message.send` to v12 and makes the process-stable
`ROVAI_RUN_TMP` a lease-isolated authenticated root.

```text
BUILTIN_TOOL_CONTRACT_VERSION = 19
BUILTIN_TOOL_CLI_COMMAND_VERSION = 19
Runtime capability = builtin_cli.transport.v19
fixed command count = 15
Camp Message Send = 12
```

Before a new lease becomes active, Core MUST reset the exact configured Run tmp: remove previous owned contents, recreate
the exact directory and restore private permissions. Failure rejects bind before writing active context or returning auth.
Unbind, unregister and process fence clear it best-effort; every later bind repeats the mandatory reset. Authentication
returns the exact reset root only for the matching active process token, lease ID/generation/token, AgentRun and epoch.

The Host environment keeps the stable path because a reusable process cannot receive a replacement environment variable
after spawn. Every Adapter MUST also pass that exact path through its native workspace/additional-directory admission;
passing only `ROVAI_RUN_TMP` in the environment is insufficient. The parent process root is never admitted. Runtime launch
compatibility is defined by [Runtime Launch and Verification v13](runtime-launch-and-verification-v13.md).

Send `body` is optional/default empty and `files` default empty. Domain admission accepts non-whitespace body or at least
one file and rejects both empty. Direct `rovai send --file <path>` is canonical. Exact help teaches attachment-only input
without exposing lease reset, Authority ingress, View gates or publication internals. v18 capability is incompatible for
new invocation; historical receipts replay without translation.

## References

- [Built-in Tool Transport v18](builtin-tool-transport-v18.md)
- [Camp Message Send v12](camp-message-send-v12.md)
- [Camp Attachment v4](camp-attachment-v4.md)
- [Runtime Launch and Verification v13](runtime-launch-and-verification-v13.md)
- [V1.19-D01](../versions/v1.19/decisions.md#v1-19-d01)
