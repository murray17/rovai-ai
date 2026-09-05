---
document_type: contract
contract: builtin-tool-transport-v23
status: accepted
target_version: v1.54
last_updated: 2026-09-07
---

# Built-in Tool Transport v23

v23 replaces [v22](builtin-tool-transport-v22.md) for new invocations. It preserves the v22
Single Chat history operation and adds seven Scheduled Automation operations to the closed Agent
catalog. IPC framing, authentication, Envelope, receipt, replay, Agent output, attachment
preparation, and the original fifteen ordinary Camp operations remain unchanged.

```text
BUILTIN_TOOL_CONTRACT_VERSION = 23
BUILTIN_TOOL_CLI_COMMAND_VERSION = 23
Runtime capability = builtin_cli.transport.v23
Catalog operations = 23
IPC protocol = 2; Envelope = 1; receipt = 1; Agent Output = 2
```

## Preserved Single Chat operation

`single_chat.history` keeps the exact v22 input, authorization, pagination, projection, and
`single_chat.history_unavailable` semantics. It remains available only to an effective
`single_chat_v1` execution; ordinary Camp qualification still exercises the original fifteen
operation matrix.

## Added Scheduled Automation operations

| Canonical operation | CLI |
| --- | --- |
| `automation.list` | `rovai automation list` |
| `automation.get` | `rovai automation get` |
| `automation.create` | `rovai automation create` |
| `automation.run` | `rovai automation run` |
| `automation.close` | `rovai automation close` |
| `automation.update` | `rovai automation update` |
| `automation.delete` | `rovai automation delete` |

`list/get` are reads. `create/run/close/update/delete` summaries and help explicitly require user
intent; possession of a current Built-in lease does not authorize a management mutation. Core
revalidates the current AgentRun, lease, membership, Automation identity, version, member, project,
channel, and command parameters on every invocation.

The projection is:

- `automation.list` → `{automations, nextCursor, truncated}`;
- `automation.get/create/close/update` → complete `AutomationView`;
- `automation.run` → `{status, runId, campId, conversationId, reason}`, where status is
  `started | skipped | failed`;
- `automation.delete` → `{automationId, deleted: true}`.

The CLI accepts exactly one input source under the existing transport rules. Schedule flags are
mutually consistent with `repeat`; invalid combinations fail before IPC.
`automationId=current` is valid only inside a Camp created by an existing AutomationRun.

## Policy and compatibility

Within `single_chat_v1`, the complete allowlist remains:

```text
camp.search
camp.read
single_chat.history
```

Automation operations use the ordinary current Built-in authorization boundary. Contract, CLI,
capability, and catalog digest advance together. Existing v22 bindings are incompatible with new
v23 execution and rotate through the existing Binding compatibility path; there is no dual stack.
The transport change itself does not alter the IPC, Envelope, receipt, or Agent Output versions.

## References

- [Built-in Tool Transport v22](builtin-tool-transport-v22.md)
- [Single Chat v2](single-chat-v2.md)
- [Scheduled Automation v1](scheduled-automation-v1.md)
- [Built-in Tool Runtime](../architecture/builtin-tool-runtime.md)
