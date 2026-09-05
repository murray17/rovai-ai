---
document_type: contract
contract: builtin-tool-transport-v22
status: accepted
target_version: v1.50
last_updated: 2026-09-05
---

# Built-in Tool Transport v22

v22 replaces [v21](builtin-tool-transport-v21.md) for new invocations. It adds seven Scheduled Automation operations to
the closed Agent catalog and changes their Agent Result Projection. v21 private context, attachment snapshot, IPC,
authentication, Envelope, receipt/replay, error, output and all existing fifteen-operation semantics remain unchanged.

```text
BUILTIN_TOOL_CONTRACT_VERSION = 22
BUILTIN_TOOL_CLI_COMMAND_VERSION = 22
Runtime capability = builtin_cli.transport.v22
Operation count = 22
IPC protocol = 2; Envelope = 1; receipt = 1; Agent Output = 2
```

## Added operations

| Canonical operation | CLI |
| --- | --- |
| `automation.list` | `rovai automation list` |
| `automation.get` | `rovai automation get` |
| `automation.create` | `rovai automation create` |
| `automation.run` | `rovai automation run` |
| `automation.close` | `rovai automation close` |
| `automation.update` | `rovai automation update` |
| `automation.delete` | `rovai automation delete` |

`list/get` are reads. `create/run/close/update/delete` summaries and help explicitly require user intent; Runtime possession
of a current Built-in lease is necessary but does not itself justify a management mutation. Core applies current AgentRun,
lease, membership and version fences on every invocation.

## Projection

- `automation.list` → `{automations, nextCursor, truncated}`;
- `automation.get/create/close/update` → complete `AutomationView`;
- `automation.run` → `{status, runId, campId, conversationId, reason}` where status is
  `started | skipped | failed`;
- `automation.delete` → `{automationId, deleted: true}`.

The CLI accepts exactly one input source under the existing v21 rules. Schedule flags are mutually consistent with
`repeat`; invalid combinations fail before IPC. `automationId=current` is valid only inside a Camp created by an existing
AutomationRun. Catalog definitions, CLI identities, runtime capability and binding compatibility digest advance together;
there is no v21/v22 dual transport for a new Run.

## References

- [Built-in Tool Transport v21](builtin-tool-transport-v21.md)
- [Scheduled Automation v1](scheduled-automation-v1.md)
- [Built-in Tool Runtime](../architecture/builtin-tool-runtime.md)
