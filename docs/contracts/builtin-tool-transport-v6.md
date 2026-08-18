---
document_type: contract
contract: builtin-tool-transport-v6
status: accepted
target_version: v0.62
last_updated: 2026-08-12
---

# Built-in Tool Transport v6

v6 keeps v5's thirteen fixed business commands, Unix IPC, complete Core Envelope, receipt, Replay,
Agent Output v2, process-scoped lease, Task v3 transport, and single-JSON stdout boundary. It replaces
only the `camp.message.send` input/schema/help/error surface with
[Camp Message Send v3](camp-message-send-v3.md).

## Fixed commands and versions

```text
rovai send
rovai task create|get|update|list
rovai camp list|search|read
rovai history search
rovai memory search|read|write|propose-hearth
```

`BUILTIN_TOOL_CONTRACT_VERSION = 6`, `BUILTIN_TOOL_CLI_COMMAND_VERSION = 6`, and Runtime capability is
`builtin_cli.transport.v6`. IPC protocol, Envelope, receipt, and Agent Output contract versions do not
change. v5 and earlier are not current parser or recovery entrypoints.

## `rovai send` surface

- accepted fields are `body`, `to`, and `taskId`;
- `replyToCampMessageId` and `--reply-to-camp-message-id` are removed;
- `--to` is repeatable and described as `Optional Agent to wake; repeat for multiple recipients.`;
- strict inline `@agent_id` remains an equal addressing source;
- omitting both addressing sources is public-only;
- addressing the direct caller means result return and wakeup; no `--return-to` exists;
- `message.reply_invalid` is removed from the operation's declared errors.

Command-local help uses the concise summary and two examples frozen in Camp Message Send v3. Catalog
and CLI help derive from one closed input schema and one operation definition; transports must not
accept a removed field that help omits.

## Unchanged transport rules

Malformed input, credentials, lease/fence, IPC, and Envelope failures remain transport errors. Domain
rejections remain successful Transport Envelopes with business error projection. Safe transport retry
windows cannot bypass Domain Gateway idempotency, and Agent-facing stdout remains exactly one JSON
document for non-help execution.

Task, Camp History, and Memory command schemas and help are unchanged from v5.

## References

- [Camp Message Send v3](camp-message-send-v3.md)
- [Built-in Tool Transport v5 (historical)](builtin-tool-transport-v5.md)
- [ADR-0163: Explicit Caller Return and Core-Managed Reply Reference](../versions/v0.62/decisions.md#adr-0163)
- [Built-in Tool Runtime architecture](../architecture/builtin-tool-runtime.md)
