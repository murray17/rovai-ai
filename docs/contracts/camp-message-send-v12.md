---
document_type: protocol-contract
contract: camp-message-send-v12
authority: camp-public-a2a-send
status: accepted
version: 12
last_updated: 2026-08-20
---

# Camp Message Send v12 Contract

v12 replaces [v11](camp-message-send-v11.md). Camp identity, addressing, PublicOnly, Principal attention, Task/reply,
Gather, fanout, budgets, idempotency, Agent file ingress, publication and accepted result remain unchanged. v12 allows an
attachment to constitute the complete public message payload.

## Closed input and CLI

The complete input is:

```json
{
  "body": "optional UTF-8 text; defaults to an empty string; at most 32 KiB",
  "to": [],
  "mentionUser": false,
  "taskId": "optional Task ID",
  "publicOnly": false,
  "files": ["optional AgentRun-local paths; defaults to []; unique; at most 10"]
}
```

Admission requires either `body.trim()` to be non-empty or at least one `files` item. Empty/whitespace body with no file
is `message.invalid_input`. The schema owns field shapes and defaults; the Domain Service owns this cross-field and
whitespace rule. An attachment-only accepted message stores body `""` and no placeholder text.

The canonical direct CLI therefore permits:

```text
rovai send --file "$ROVAI_RUN_TMP/report.pdf"
```

Repeatable `--file`, path admission, immutable Authority freeze and all limits remain v11. Empty body has no inline Agent
addressing; explicit `--to`, `--public-only`, `--to-principal`, Task and reply rules are unchanged.

## Accepted semantic commit and outcome

The Send transaction still creates the real public CampMessage, ordered `message_attachment`, semantic revision,
publication operation, quota reservation and every real Delivery before returning `status=accepted`. Attachment-only
input uses the same `projection_blocked/attachment_projection` Delivery gate. Compact Agent output remains
`{messageId, agentAddressingMode, effectiveRecipients, deliveryIds}` and exposes no publication state.

Exact replay returns the same IDs and does not inspect source paths again. Runtime projection success/failure, failed
tombstone, public history and path availability remain defined by Camp Attachment/View and Message Delivery contracts.

## References

- [Camp Message Send v11](camp-message-send-v11.md)
- [Camp Attachment v4](camp-attachment-v4.md)
- [Message Delivery v5](message-delivery-v5.md)
- [Built-in Tool Transport v19](builtin-tool-transport-v19.md)
- [V1.19-D02](../versions/v1.19/decisions.md#v1-19-d02)
