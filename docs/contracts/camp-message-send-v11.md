---
document_type: protocol-contract
contract: camp-message-send-v11
authority: camp-public-a2a-send
status: accepted
version: 11
last_updated: 2026-08-20
---

# Camp Message Send v11 Contract

v11 replaces [v10](camp-message-send-v10.md). Camp identity, addressing, PublicOnly, Principal attention, Task/reply,
Gather, fanout, budgets, idempotency and accepted result remain unchanged. v11 adds Agent-owned attachment ingress and
binds accepted Send to the unified asynchronous publication contract.

## Closed input and CLI

The complete input adds one optional field:

```json
{
  "body": "required non-empty UTF-8 text, at most 32 KiB",
  "to": [],
  "mentionUser": false,
  "taskId": "optional Task ID",
  "publicOnly": false,
  "files": ["optional AgentRun-local paths; unique; at most 10"]
}
```

`files` defaults to `[]`; the object remains closed and `body` remains required/non-empty. The canonical CLI mapping is
repeatable `--file <path>`. Each source must resolve, without symlink/reparse or mount escape, inside the authenticated
AgentRun execution workspace or the exact `ROVAI_RUN_TMP` of the invoking process. Relative paths resolve from the
execution workspace. Authority, Runtime View, another Run tmp and arbitrary absolute paths fail closed.

Each item is frozen to immutable Attachment Authority under the existing file/directory limits: 10 top-level items,
25 MiB per regular file, 64 MiB aggregate, 2,000 files, 4,000 nodes and depth 32. Freeze performs blocking filesystem
work without the global Database mutex or built-in invocation guard. Before semantic commit Core must reauthenticate the
same invocation, lease, AgentRun, execution epoch and run tmp. Rejection removes only unowned frozen Authority nodes;
startup cleanup owns crash orphans.

## Accepted semantic commit

The Send transaction creates the ordinary public CampMessage, ordered `message_attachment`, semantic revision,
publication operation, quota reservation and all recipient Deliveries. A Delivery with attachment publication starts in
the `projection_blocked/attachment_projection` gate defined by [Message Delivery v5](message-delivery-v5.md).

The canonical Send result and compact Agent projection remain v10 shapes: `status=accepted` returns the real
`messageId`, `campTurnId` and real `deliveryIds`; no pending/projection field is exposed to the Agent. Exact replay returns
the same IDs and does not freeze, publish, reserve or dispatch again. File paths and frozen Authority paths participate in
the durable input digest, but are never emitted in public message text or Agent output.

## Publication outcome

Projection success makes every new attachment `available`, advances the Runtime catalog and releases Delivery gates.
Recoverable failure retains reservation, writer intent and gate. Terminal failure keeps the public attachment row with
state `failed`, records a tombstone and settles gated Deliveries as `attachment_projection_failed`; it never fabricates a
Runtime path or rewrites the accepted Send result.

## References

- [Camp Message Send v10](camp-message-send-v10.md)
- [Camp Attachment v3](camp-attachment-v3.md)
- [Message Delivery v5](message-delivery-v5.md)
- [Built-in Tool Transport v18](builtin-tool-transport-v18.md)
- [V1.17-D01](../versions/v1.17/decisions.md#v1-17-d01)

