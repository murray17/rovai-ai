---
document_type: protocol-contract
contract: camp-message-send-v2
authority: camp-public-a2a-send
status: accepted
version: 2
last_updated: 2026-08-08
---

# Camp Message Send v2 Contract

This contract is the v0.46 clean break for `camp.message.send` (CLI presentation: `rovai send`). It
keeps the Public A2A Message, addressing, recipient, fanout, lineage, and Delivery semantics from
[Camp Message Send v1](camp-message-send-v1.md), but removes Agent selection of the Camp and fixes the
durable replay identity boundary. Transport output follows
[Built-in Tool Transport v3](builtin-tool-transport-v3.md).

## 1. Agent input has no Camp selector

The Agent-facing canonical JSON input is:

```json
{
  "body": "请检查最新构建并把结论写回公共区 @agent_104",
  "to": ["agent_27"],
  "replyToCampMessageId": "msg_…",
  "taskId": "task_…"
}
```

`body` is required and non-empty. `to`, `replyToCampMessageId`, and `taskId` may be omitted. The
input object is closed: `campId` is not a recognized property.

The CLI has no `--camp-id`. A supplied `--camp-id`, JSON `campId`, alias, or silent translation is a
clean-break violation and returns:

```json
{"error":{"code":"builtin_tool.invalid_input","message":"Command input does not match the accepted arguments.","recovery":"fix_input"}}
```

The same rule applies to direct flags, stdin, heredoc, input files, Bootstrap examples, Charter,
command help, fixtures, smoke scripts, and documentation. A caller must not retry the old shape with a
new request identity.

## 2. One authoritative Camp source

The Camp is derived only from the authenticated current Run:

```text
Lease
  → AgentRun + executionEpoch + NativeBinding
  → resolve_sender_identity()
  → authenticated campId
  → internal CampMessageSendCommand.camp_id
```

`BuiltinToolCliContext` and `BuiltinToolLease` do not gain a `campId` field. The Agent never chooses or
overrides the Camp, and a Runtime process identity alone never authorizes a Camp.

For the first invocation, Core authenticates the current Run and copies its authoritative Camp into
the internal `CampMessageSendCommand`. Addressing and recipient resolution then execute within that
Camp exactly once, atomically with the public message and its Deliveries.

Other cross-Camp read operations (`camp.list`, `history.search`, and any operation whose existing
business contract explicitly accepts `campId`) retain their explicit Camp input. This change is not a
global removal of Camp IDs.

## 3. Addressing and atomic result

The v1 rules remain in force:

- strict `@agent_<positive integer>` tokens are recognized only in parseable public text;
- explicit `to`, valid inline tokens, and an eligible direct-reply author form the union of effective
  recipients;
- invalid, self, unavailable, or out-of-Camp targets reject the whole request before persistence;
- recipients are deduplicated, normalized, sorted by canonical Agent ID bytes, and frozen;
- fanout is bounded by the current CampTurn budget and the product maximum of 16;
- A2A lineage has a maximum depth of 5 and rejects self/ancestor cycles;
- public-only sends create no Delivery and consume no A2A slot.

Core's canonical result retains the full business result for IPC and evidence. The v0.46 Agent Result
Projection returns only:

```json
{"messageId":"msg_123","effectiveRecipients":["agent_27"]}
```

For a public-only message, `effectiveRecipients` is an empty array. The projection does not imply that
recipient work started or completed.

## 4. Durable idempotency and replay

The durable command identity remains scoped to the authenticated invocation. A newly accepted command
records, together with its canonical payload:

```text
camp_id
source AgentRun (agent_run_id)
executionEpoch
native binding identity/digest
runtime tool call identity
```

On a durable Replay, Core loads the recorded command identity and constructs the replay envelope from
the recorded `camp_id`, recorded source AgentRun, and recorded `executionEpoch`. It does not call the
current active identity resolver to choose a new Camp. This preserves the v0.45 recorded-identity
replay safety property while removing Camp selection from Agent input.

If the current attested lease does not match the recorded invocation fence, Core fails closed. A
different input under the same command identity is a stable
`builtin_tool.idempotency_conflict`; the v0.46 formal code is not `message.idempotency_conflict`.
Replay returns the original canonical result/Envelope and never re-runs message persistence or
Delivery creation.

## 5. Camp mismatch is not an Agent product error

Under this contract there is one authoritative Camp source, so a normal request cannot have a
user-correctable Camp mismatch. `message.camp_mismatch` is removed from:

- `camp.message.send` Agent error contracts and recovery mapping;
- Core catalog/description exposed to contract tooling;
- help, fixtures, golden errors, and smoke assertions.

An internal assertion may still compare the recorded command Camp, authenticated sender Camp, and
envelope Camp to detect corruption or an implementation defect. If it fires, the operation fails closed
through a safe generic internal/protocol path. v0.46 does not publish a new stable
`builtin_tool.protocol_violation` code and never maps this condition to `fix_input`.

## 6. Errors and recovery

The v1 business errors remain, except for the removed mismatch code and the normalized idempotency code:

```text
builtin_tool.invalid_input            → fix_input
builtin_tool.run_not_bound            → stop
builtin_tool.idempotency_conflict     → stop
message.addressing_invalid             → fix_input
message.reply_invalid                 → fix_input
message.fanout_exceeded               → fix_input
message.a2a_depth_exhausted            → fix_input
message.task_recipient_ambiguous      → fix_input
message.invalid_task                  → fix_input
message.execution_budget_exceeded    → fix_input
```

All Agent-facing business failures use the v0.46 error projection (`error.code`, `message`,
`recovery`, and safe contract-approved details). `builtin_tool.outcome_indeterminate` follows the
transport contract and does not expose `requestId`.

## 7. Clean-slate data boundary

v0.46 does not migrate, reinterpret, or replay old `camp.message.send` input, old replay records, or
old Rovai-owned App data. Development cutover may use the managed clean reset defined by
[ADR-0118](../versions/v0.41/decisions.md#adr-0118): only its explicit
Rovai-owned allowlist may be cleared. User workspaces, external Runtime state, Native Homes,
credentials, and MCP configuration are never reset by this contract.

## 8. Help and examples

The only Agent-facing discovery aid is command-local help:

```sh
rovai send --help
rovai send --body "构建已完成，请检查 @agent_27"
echo '{"body":"只发公共消息"}' | rovai send
rovai send --input-file request.json
```

Examples must never show `campId` or `--camp-id`, and must not instruct the Agent to call a catalog
discovery command.

## References

- [Built-in Tool Transport v3](builtin-tool-transport-v3.md)
- [Camp Message Send v1 (historical)](camp-message-send-v1.md)
- [ADR-0135: Compact Agent Output over Canonical Built-in Tool Envelope](../versions/v0.46/decisions.md#adr-0135)
- [ADR-0118: Local Data Clean Break and Managed Reset Boundary](../versions/v0.41/decisions.md#adr-0118)
- [Public A2A Message and Message Delivery architecture](../architecture/public-a2a-message-delivery.md)
