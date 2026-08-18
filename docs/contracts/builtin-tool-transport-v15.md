---
document_type: contract
contract: builtin-tool-transport-v15
status: proposed
target_version: v1.07
last_updated: 2026-08-18
---

# Built-in Tool Transport v15 (Proposal)

Model-context revision 1 is confirmed. This proposal would replace
[Built-in Tool Transport v14](builtin-tool-transport-v14.md) only after its own acceptance and implementation; v14
remains the accepted current contract. v15 inherits every v14 endpoint, IPC and security requirement,
including the required discriminated `LocalIpcEndpoint`, IPC protocol v2, Unix Socket, protected Windows Named Pipe,
Envelope/receipt/replay, process/lease identity, idempotency, single-JSON stdout and the fifteen-command catalog.

```text
BUILTIN_TOOL_CONTRACT_VERSION = 15
BUILTIN_TOOL_CLI_COMMAND_VERSION = 15
Runtime capability = builtin_cli.transport.v15
fixed command count = 15
IPC protocol = 2; Envelope = 1; receipt = 1; Agent Output = 2
```

## v14 inheritance and release fence

Implementation moves atomically from v13 to v15. Advertising v15 requires the complete v14
`core_endpoint: LocalIpcEndpoint` context, IPC2 framing/version fence, Unix regression and Windows Named Pipe security
plus all v15 changes below. v15 with `core_socket`, IPC1, dual optional endpoints or a v13/v15 mixed Binding is invalid.
Core and CLI drain/update together; no downgrade or dual-stack mode is introduced.

## Send command delta

`rovai send` maps to the closed [Camp Message Send v10](camp-message-send-v10.md) input. The direct argument contract is:

```text
--body <TEXT>                 required exactly once
--to <AGENT_ID>              optional, repeatable
--to-principal               optional Boolean switch
--task-id <TASK_ID>          optional exactly once
--public-only                optional Boolean switch
```

Direct flags, one JSON stdin/heredoc object and `--input-file <path>` remain mutually exclusive. The JSON field names
are `body`, `to`, `mentionUser`, `taskId`, `publicOnly`. Hidden legacy `--to-user` is normalized to
`--to-principal` before the existing non-repeatable duplicate check; supplying both aliases therefore fails as duplicate
input. No deprecation warning is written to stdout/stderr.

The canonical catalog adds `message.public_only_conflict → fix_input`. Its closed details are
`conflictingFields: ("to" | "taskId")[]` plus `newRequestIdRequired: true`. Catalog input/result schema, CLI mapping,
error list, Agent schema, projection identity, help, digest, compatibility, Bootstrap, health, diagnostics and product
fingerprints all move together to v15.

## Agent Output

Agent Output remains version 2: Core first returns and validates one complete Envelope v1, then the CLI applies the
closed operation projection and emits one JSON document. `camp.message.send` projection identity advances from
`camp-message-send-v1` to `camp-message-send-v2`:

```json
{
  "messageId": "message-id",
  "agentAddressingMode": "automatic | public_only",
  "effectiveRecipients": ["agent_5"],
  "deliveryIds": ["delivery-id"]
}
```

All four fields are required; recipient/delivery arrays are unique and bounded at 16. Other operation projections,
including Gather, remain unchanged. Core-success/local-projection failure continues to use
`builtin_tool.output_contract_mismatch / stop` and private diagnostics.

## Exact Send teaching

The catalog summary is:

```text
Publish one public Camp message. Use --public-only when the message must not address any Agent; it bypasses all inline Agent addressing, leaves Agent-like @text literal, and creates no Agent Delivery. Without --public-only, --to and the existing restricted inline Agent addressing may schedule Agents. Agent addressing schedules concrete continuing work, not CC; never use it for acknowledgement, agreement, thanks, closure, standby, no-new-information, or repeated conclusions. Ordinary public messages are already visible to the Principal. Use --to-principal only for a new unresolved Principal decision, answer, or action, or an explicitly requested important-result notification. Always inspect agentAddressingMode, effectiveRecipients, and deliveryIds. A successful send proves only that its message and effects were committed; it does not prove recipient work has started or completed.
```

`publicOnly` schema description is:

```text
Guarantee that this public Camp message addresses no Agent. When true, explicit Agent recipients and taskId are invalid, restricted inline Agent addressing is not parsed, Agent-like @text remains ordinary text, effectiveRecipients and deliveryIds are empty, and no Agent is woken. This may be combined with mentionUser because Principal attention is not Agent routing.
```

`mentionUser` schema description is:

```text
Mention the Principal and create an Inbox notification. Ordinary public Camp messages are already visible to the Principal. Use this only when the message creates a new unresolved decision, answer, or action for the Principal, or when the Principal explicitly requested notification of an important result. It creates no Agent Delivery, does not represent approval, and may be combined with publicOnly. Principal attention is message-local and is never inherited.
```

Operation help uses these exact blocks:

```text
--to <AGENT_ID>
Explicit Agent recipient to wake; repeat as needed.
Agent addressing schedules concrete continuing work, not CC.
Do not use it for acknowledgement, agreement, thanks, closure, standby, no-new-information, or a repeated conclusion.
This option is invalid with --public-only.

--public-only
Guarantee that this public message wakes no Agent.

Restricted inline Agent addressing is disabled, Agent-like @text remains ordinary text, effectiveRecipients and deliveryIds are empty, and no Agent Delivery is created.

Do not combine this option with --to or --task-id. It may be combined with --to-principal.

--to-principal
Mention the Principal and create an Inbox notification.

Ordinary public Camp messages are already visible to the Principal. Use this flag only when the message creates a new unresolved decision, answer, or action for the Principal, or when the Principal explicitly requested notification of an important result.

It creates no Agent Delivery, does not represent approval, and may be combined with --public-only. Principal attention is message-local and is never inherited by replies, Tasks, or downstream A2A work.
```

Canonical examples are exactly:

```text
rovai send --public-only --body 'Final conclusion: the failure is a client-version regression.'
rovai send --to agent_5 --body 'Please reproduce on the previous client build and return the version and result.'
rovai send --public-only --to-principal --body 'Please choose whether to roll back the client or continue the token investigation.'
```

## Compatibility and qualification

The Binding compatibility digest also carries Context Formatter 19 / ContextManifest 17 through the existing context
contract object. Old v13/v14 capability, Formatter18/Manifest16 and old catalog digests fail before invocation. macOS
must repeat discovery, read, mutation, rejection, replay, process/lease fencing and projection mismatch over Unix
Socket/IPC2. Windows requires the same matrix over its secured Named Pipe for each admitted Runtime.

## References

- [ADR-0217](../adr/0217-transport-v15-inherits-cross-platform-v14.md)
- [Built-in Tool Transport v14 (accepted predecessor)](builtin-tool-transport-v14.md)
- [Camp Message Send v10 proposal](camp-message-send-v10.md)
- [Built-in Tool Agent Output Projection v1](builtin-tool-agent-output-projection-v1.md)
