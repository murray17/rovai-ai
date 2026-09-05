---
document_type: contract
contract: builtin-tool-transport-v22
status: accepted
target_version: v1.50
last_updated: 2026-09-05
---

# Built-in Tool Transport v22

v22 replaces [v21](builtin-tool-transport-v21.md) for new invocations. It adds one read-only,
Single Chat-only operation while preserving v21 IPC framing, authentication, Envelope, receipt,
replay, Agent output, attachment preparation, and the existing fifteen operations.

```text
BUILTIN_TOOL_CONTRACT_VERSION = 22
BUILTIN_TOOL_CLI_COMMAND_VERSION = 22
Runtime capability = builtin_cli.transport.v22
Catalog operations = 16
IPC protocol = 2; Envelope = 1; receipt = 1; Agent Output = 2
```

## `single_chat.history`

Canonical operation and CLI command:

```text
single_chat.history
rovai single-chat history
```

Input is a closed object:

```json
{
  "beforeSequence": 12,
  "limit": 20
}
```

- `beforeSequence` is optional, positive, and exclusive.
- `limit` is optional, defaults to `20`, and is limited to `1..=50`.
- `conversationId`, `campId`, `agentId`, and every unknown property are invalid input.

Core derives the target from the authenticated current `AgentRun`. Authorization requires an active
execution with `invocation_kind=single_chat`, `response_delivery=conversation_message`,
`operation_policy=single_chat_v1`, the current policy version, an active destination Single Chat
Conversation, and the exact triggering user `conversation_message`. A non-Single Chat Run or a
stale/inactive target returns `single_chat.history_unavailable`.

The default upper bound is the sequence of `CURRENT_INPUT`. A caller-provided upper bound is clamped
to that same sequence. Core returns only earlier user and assistant message bodies from the derived
Conversation, ordered by ascending sequence:

```json
{
  "schemaVersion": 1,
  "messages": [
    {
      "sequence": 1,
      "role": "user",
      "body": "方案 A 和 B 哪个更好？",
      "attachments": []
    },
    {
      "sequence": 2,
      "role": "assistant",
      "body": "我建议 B，因为……",
      "attachments": []
    }
  ],
  "hasMore": false,
  "nextBeforeSequence": null
}
```

When `hasMore=true`, `nextBeforeSequence` is the first sequence in the returned page and is the
exclusive cursor for the next older page. The result never exposes AgentRun, CampTurn, Native
Binding, Runtime Input Delivery, or Execution Evidence. Reading history does not mutate the
Conversation, advance its public watermark, or create a message.

## Policy and compatibility

The global catalog has sixteen commands, while ordinary Camp Runtime qualification continues to
exercise the original fifteen-command matrix. `single_chat.history` is denied outside an effective
Single Chat execution. Within `single_chat_v1`, the complete allowlist is now only:

```text
camp.search
camp.read
single_chat.history
```

Contract, CLI, capability, and catalog digest advance together. Existing v21 bindings are
incompatible with new v22 execution and rotate through the existing Binding compatibility path;
there is no dual stack. No database migration, IPC version change, or evidence-table change is
introduced.

## References

- [Single Chat v1](single-chat-v1.md)
- [Built-in Tool Runtime](../architecture/builtin-tool-runtime.md)
- [Confirmed Single Chat model-context revision 2](../versions/v1.50/model-context-change-single-chat.md)
