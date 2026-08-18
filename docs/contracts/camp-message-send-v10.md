---
document_type: protocol-contract
contract: camp-message-send-v10
authority: camp-public-a2a-send
status: accepted
version: 10
last_updated: 2026-08-18
---

# Camp Message Send v10 Contract

Model-context revision 1 is confirmed. This contract replaces
[Camp Message Send v9](camp-message-send-v9.md) as the current entry. v10 preserves v9's Camp identity, public message, Current User
Attention, canonical recipient parser, Task/reply admission, forward/return lineage, Gather capture, fanout, execution
budget, atomicity, idempotency and dispatch semantics except where this document explicitly changes Send addressing.

## 1. Closed Agent input

The complete `camp.message.send` input is:

```json
{
  "body": "required non-empty UTF-8 text, at most the existing 32 KiB bound",
  "to": ["optional canonical Agent IDs; unique; at most 16"],
  "mentionUser": false,
  "taskId": "optional non-empty current Camp Task ID",
  "publicOnly": false
}
```

The object is closed. `body` is required. `to` defaults to `[]`; `mentionUser` and `publicOnly` default to `false`;
`taskId` is omitted when absent. JSON stdin and `--input-file` use these durable field names. Canonical CLI flags are:

```text
body        ← --body
to[]        ← repeatable --to
mentionUser ← --to-principal
taskId      ← --task-id
publicOnly  ← --public-only
```

`--to-user` is an undiscoverable compatibility alias normalized to `--to-principal` before ordinary duplicate-argument
validation. It never appears in root help, operation help, schema descriptions, Charter, model context or examples.

## 2. Durable addressing intent

After closed-input validation and before any body-addressing parse, the Agent input maps to:

```rust
enum AgentAddressingMode {
    Automatic,
    PublicOnly,
}
```

```text
publicOnly omitted/false → Automatic
publicOnly true          → PublicOnly
```

The mode is serialized in the durable command and its digest, persisted separately on the resulting CampMessage send
audit, and reused on replay. It MUST NOT be inferred from `effectiveRecipients`, `deliveryIds`, `address_mode`,
Structured Content or the body. The persistence field is semantically
`agent_addressing_mode = automatic | public_only`; existing `address_mode = default | explicit | broadcast` retains
its presentation/outcome meaning.

Applicability is closed: a CampMessage created by explicit `camp.message.send` requires exactly one mode; a user
Composer message and Runtime automatic-final/Missing-Send Recovery message have no mode because they are not this
operation. Gather keeps its independent required-recipient command semantics; where the shared send event needs the
new field it projects `automatic`, but this does not manufacture a `camp.message.send` intent record for Gather.

v1.07 does not backfill this field into v1.06 messages: the development-data clean break creates explicit Send audit
rows with the required intent from inception. A null/not-applicable value for another message provenance is not a
legacy default and cannot be read as Automatic. No legacy Send reader is part of v10.

## 3. Automatic mode

Automatic preserves v9 exactly:

```text
effectiveRecipients = stable unique(
  explicit canonical `to` recipients
  + existing restricted inline canonical-ID/display-name recipients
)
```

Parser grammar, code/URL/escaped exclusions, line-leading display-name alias, membership, self/ancestor cycle, depth,
fanout, Task, forward/return, Gather capture and budget checks do not broaden. A successful Automatic send may resolve
zero recipients. That outcome is not PublicOnly intent.

## 4. PublicOnly mode

After structural validation, PublicOnly rejects either actual routing field before parser/member lookup:

```text
non-empty to → conflict field "to"
present taskId → conflict field "taskId"
```

If both are present, both appear once in that order. The whole command is rejected before any mutation:

```json
{
  "error": {
    "code": "message.public_only_conflict",
    "message": "--public-only cannot be combined with Agent-routing inputs.",
    "recovery": "fix_input",
    "details": {
      "conflictingFields": ["to", "taskId"],
      "newRequestIdRequired": true
    }
  }
}
```

For valid PublicOnly, Core MUST NOT call the inline parser, load Agent aliases for body addressing, validate body
lookalikes as recipients or construct MemberMention. Canonical IDs, valid/invalid/stale display names, self/ancestor
names and first/final-line lookalikes remain literal Text. Core constructs normalized Structured Content from exactly
that Text plus an optional Core-owned CurrentUserMention when `mentionUser=true`.

The accepted postconditions are all mandatory:

```text
agentAddressingMode = public_only
effectiveRecipients = []
deliveryIds = []
MemberMention count = 0
new accepted-A2A allocation = 0
new AgentRun responsibility allocation = 0
Message Delivery count = 0
```

`mentionUser=true` is allowed because Principal attention creates a CurrentUserMention/Inbox effect, not an Agent
recipient, Delivery or approval. Existing message-local attention admission and notification atomicity remain.

## 5. Result, event and projection facts

The canonical accepted Send result adds one required field to the v9 result:

```json
{
  "status": "accepted",
  "messageId": "message-id",
  "visibility": "camp_public",
  "campTurnId": "camp-turn-id",
  "agentAddressingMode": "automatic | public_only",
  "effectiveRecipients": [],
  "recipientPresentation": {},
  "recipientSetDigest": "sha256:...",
  "deliveryIds": [],
  "allocatedAgentRunResponsibilities": 1
}
```

`allocatedAgentRunResponsibilities` retains its existing cumulative CampTurn meaning; the required PublicOnly
postcondition is zero *new* allocation, not that this cumulative field becomes zero.

The compact Agent projection identity becomes `camp-message-send-v2` and is exactly:

```json
{
  "messageId": "message-id",
  "agentAddressingMode": "public_only",
  "effectiveRecipients": [],
  "deliveryIds": []
}
```

The global Agent Output mechanism remains v2. The operation projection changes because callers need to distinguish
explicit no-address intent from an empty Automatic parse and verify zero Delivery.

The v1.07 clean-break `camp_message.public_a2a_sent` payload becomes a closed union discriminated by its existing
`operation`. Both variants replace the misleading old derived `publicOnly` name with required
`recipientFree = deliveryIds.is_empty()`:

```json
{
  "schemaVersion": 2,
  "messageId": "message-id",
  "campTurnId": "camp-turn-id",
  "operation": "send",
  "agentAddressingMode": "automatic",
  "recipientFree": true,
  "effectiveRecipients": [],
  "recipientSetDigest": "sha256:...",
  "deliveryIds": []
}
```

The `operation="send"` variant requires `agentAddressingMode` from the persisted explicit Send audit. The
`operation="gather"` variant requires `agentAddressingMode:null`, because Gather has its own required-recipient intent
and no `publicOnly` input. Its otherwise complete shape is identical (`schemaVersion/messageId/campTurnId/operation/
agentAddressingMode/recipientFree/effectiveRecipients/recipientSetDigest/deliveryIds`). Every listed field is required;
the two objects are closed. No v1 event reader or event-log backfill is provided; no consumer may reinterpret the old
field as `--public-only` intent.

## 6. Idempotency, replay and recovery

`publicOnly` participates in the durable command preimage. Reusing a Runtime tool-call/request identity with another
mode is an idempotency conflict. Exact replay returns the original mode/result/message/Deliveries and performs no parse,
allocation, notification or dispatch again.

Runtime automatic final and Missing-Send Recovery remain outside this input contract. They always publish one
recipient-free message with Structured Content `[{"kind":"text","text":candidate}]`, empty recipient/Delivery sets,
no reply and zero A2A allocation, even when the candidate begins or ends with a canonical Agent ID or display-name
alias. This phase does not suppress return-continuation recovery.

## 7. Required negative matrix

| Input | Required outcome |
| --- | --- |
| `publicOnly=true`, body `@agent_2 谢谢` | accepted; literal Text; mode public_only; zero MemberMention/Delivery/allocation |
| `publicOnly=true`, valid line-leading display alias | accepted; alias not loaded or parsed; literal Text |
| `publicOnly=true`, `to=[agent_2]` | `message.public_only_conflict/fix_input`, details `to`, no mutation |
| `publicOnly=true`, `taskId=task_1` | same error, details `taskId`, no mutation |
| `publicOnly=true`, `mentionUser=true` | CurrentUserMention and Inbox effect; no Agent Delivery |
| Automatic with no parsed recipient | mode automatic and both arrays empty |
| automatic recovery candidate with Agent-like text | literal Text, null reply, zero Delivery/allocation |

## References

- [ADR-0216](../versions/v1.07/decisions.md#adr-0216)
- [Camp Message Send v9 (accepted predecessor)](camp-message-send-v9.md)
- [Missing-Send Recovery Publication v1](missing-send-recovery-publication-v1.md)
- [Built-in Tool Transport v15](builtin-tool-transport-v15.md)
