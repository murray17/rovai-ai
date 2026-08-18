---
document_type: protocol-contract
contract: builtin-tool-transport-v3
authority: builtin-tool-wire-contract
status: accepted
version: 3
last_updated: 2026-08-08
---

# Built-in Tool Transport v3 Contract

v0.46 keeps the Core-owned IPC envelope and receipt versions from v0.45 while changing the
Agent-facing boundary. The CLI is a fixed business-command client: it validates a complete Core
Envelope and then emits an operation-specific Agent Result Projection. It does not expose the
transport envelope or the Core catalog as an Agent discovery protocol.

The v0.45 [Transport v2 contract](builtin-tool-transport-v2.md) and
[Camp Message Send v1 contract](camp-message-send-v1.md) remain historical contracts. v0.46 is a
clean break; no v2 Agent input, output-mode switch, discovery command, or old send alias is accepted.

## 1. Version identity

The v0.46 catalog and Runtime capability use the following exact constants:

```yaml
contractVersion: 3
ipcProtocolVersion: 1
envelopeContractVersion: 1
receiptVersion: 1
cliCommandVersion: 3
agentOutputContractVersion: 1
runtimeCapability: builtin_cli.transport.v3
```

`contractVersion` identifies the catalog/CLI contract. `envelopeContractVersion` and `receiptVersion`
remain v1 because the Core wire shape and receipt preimage do not change. `catalogDigest` covers all
constants above, the twelve operation definitions, each input schema, canonical result schema,
`agentOutputSchema`, projection identity, and error contracts.

An App update must bind a Runtime to v3 before it accepts Agent input. A process, lease, or catalog
from v0.45 cannot be silently translated into v0.46.

## 2. Authority and processing path

The authority split is:

| Layer | Contract |
| --- | --- |
| Core IPC | Complete `BuiltinToolInvocationEnvelope`, validated before it is returned to a client |
| Core catalog | The only catalog source for operation identity, input/result schemas, `agentOutputSchema`, projection identity, errors, CLI mapping, and digest |
| CLI | Parse one input source, send authenticated IPC, validate the complete Envelope, apply the explicit projection, print one JSON document |
| Agent Runtime | Sees fixed business commands, concise command help, projected business result, and projected error only |
| Evidence / Qualification / host debug | May retain and inspect the complete Envelope, request identity, and receipt through a host-controlled path |

The only normal Agent path is:

```text
canonical domain result
  → Core Invocation Envelope
  → envelope.validate()
  → operation-specific Agent Result Projection
  → one JSON line on stdout
```

The projection is never used to form a receipt, decide replay, or authorize a second invocation.

## 3. Core IPC envelope

Core IPC retains the v1 envelope shape:

```json
{
  "contractVersion": 1,
  "ok": true,
  "operation": "camp.message.send",
  "requestId": "uuid",
  "receipt": "sha256:…",
  "result": {
    "status": "accepted",
    "messageId": "msg_123",
    "effectiveRecipients": ["agent_27"]
  }
}
```

For a business rejection, `ok` is false and `error` replaces `result`. The complete envelope must
validate its operation, UUID request identity, mutually exclusive result/error, canonical result or
error shape, and receipt preimage before projection.

The Core may expose catalog materialization or detailed descriptions to Qualification and development
diagnostics through a host-controlled API. Those APIs are not part of the Agent Runtime command
surface and must not be reachable through an undocumented executable alias.

## 4. Fixed Agent command surface

The twelve fixed commands remain:

| Agent command | Canonical operation |
| --- | --- |
| `rovai send` | `camp.message.send` |
| `rovai task create` | `team.create_task` |
| `rovai task list` | `team.list_tasks` |
| `rovai task update` | `team.update_task` |
| `rovai camp list` | `camp.list` |
| `rovai camp search` | `camp.search` |
| `rovai camp read` | `camp.read` |
| `rovai history search` | `history.search` |
| `rovai memory search` | `memory.search` |
| `rovai memory read` | `memory.read` |
| `rovai memory write` | `memory.write` |
| `rovai memory propose-hearth` | `memory.propose_hearth` |

The CLI has no Agent-facing `rovai tool list`, `rovai tool describe`, hidden discovery command,
`rovai tool invoke`, or `rovai tool call`. Dotted operation names remain internal identity and catalog
keys. A command's `--help` is deliberately short: direct flags, input-source exclusivity, essential
constraints, and one short example. It does not print a full JSON Schema, Envelope schema, receipt
preimage, catalog digest, or complete error table.

Each invocation chooses exactly one input source: direct flags, one JSON object from stdin/heredoc, or
`--input-file <path>`. Sources are not merged.

## 5. Agent Result Projection

### 5.1 Boundary rule

Agent success is the direct projected business object; it is not a smaller Envelope:

```json
{"messageId":"msg_123","effectiveRecipients":["agent_27"]}
```

Agent business failure is:

```json
{
  "error": {
    "code": "task.version_conflict",
    "message": "Task changed; read the current Task before deciding whether to update it.",
    "recovery": "refresh_then_decide",
    "details": {"currentVersion": 4}
  }
}
```

At the Envelope-to-Agent boundary, the projection must not pass through Envelope-owned
`contractVersion`, `ok`, `operation`, `requestId`, or `receipt`, and must not retain the `result`
wrapper. This prohibition is scoped to Envelope fields at that boundary. It is not a global ban on
business properties: a future canonical business result may legitimately contain a property named
`operation`, `requestId`, or another same-named field.

Every operation has a closed, explicit `agentOutputSchema` with `additionalProperties: false` at each
object boundary covered by the contract, plus an Envelope → Agent success golden fixture. Error
channels have separate deterministic negative tests. The CLI validates the projected document against
the applicable success/error schema. There is no generic recursive field-deletion or forbidden-name
scanner.

Meaningful values such as `false`, `null`, `[]`, `truncated`, `searchIncomplete`, `hasMore`,
`bodyTruncated`, `nextBodyOffset`, `cacheState`, and `effective: false` remain when the operation
schema requires them.

### 5.2 Operation projection matrix

| Operation | Agent success projection | Projection rule |
| --- | --- | --- |
| `camp.message.send` | `{messageId, effectiveRecipients}` | Explicitly omit transport/audit and redundant acceptance/presentation fields; keep the actual resolved recipient set, including `[]`. |
| `team.create_task` | Canonical result `{taskId, status, version}` | Task input and business result are unchanged. |
| `team.list_tasks` | Canonical task-list result | Preserve task fields, cursors, truncation, nullable assignments, and available actions. |
| `team.update_task` | Canonical result `{taskId, status, assigneeAgentId, version}` | Task input and optimistic-version semantics are unchanged. |
| `camp.list` | Canonical result | Preserve camp identities, titles, timestamps, and `truncated`. |
| `camp.search` | Canonical result | Preserve bounded hits, snippets, `truncated`, and `searchIncomplete`. |
| `camp.read` | Canonical result | Preserve its explicit `campId` input contract plus mode, cursors, body/attachment truncation, and nullable continuation fields. |
| `history.search` | Canonical result | Preserve authorized cross-Camp hit metadata and incompleteness markers. |
| `memory.search` | Canonical result | Preserve bounded discovery results and revision identity. |
| `memory.read` | Canonical result | Preserve `cacheState`, nullable revision/body fields, and lifecycle outcomes. |
| `memory.write` | `{memoryId, revisionId}` | Omit `action` and `effective: true` because success and input establish them; retain both durable identities. |
| `memory.propose_hearth` | Canonical result | Preserve `proposalId`, `status: pending`, and `effective: false`. |

The matrix is normative, not a generic field heuristic. A future projection change requires updating
the catalog's explicit `agentOutputSchema`, projection identity, golden fixture, and this contract.

### 5.3 Error projection

Business errors retain the business-required `code`, safe `message`, and `recovery`; `details` is
retained only when the operation's error contract says it is useful and safe. The recovery vocabulary
is closed:

```text
fix_input
refresh_then_decide
retry_same_request
stop
confirm_outcome
```

`message.camp_mismatch` is not an Agent error for `camp.message.send` in v0.46. Camp identity has one
authoritative source, so a mismatch is an internal invariant failure, not fixable input. Implementations
may assert it and fail closed through an existing generic internal/protocol failure; they must not add a
stable `builtin_tool.protocol_violation` contract.

## 6. stdout, stderr, and exit codes

All predictable outcomes write one structured JSON document to stdout:

| Situation | stdout | exit |
| --- | --- | ---: |
| Projected business success | Direct operation result | `0` |
| Authoritative business rejection | `{"error":{"code","message","recovery",…}}` | `1` |
| `builtin_tool.outcome_indeterminate` | Stable error only; no operation or request identity | `3` |
| CLI argument/source invalid | `builtin_tool.invalid_input` + `fix_input` | `2` |
| Predictable context/IPC/protocol failure | Safe generic structured error, not an operation-specific business error | `2` |
| Unstructured process-level failure | No required JSON contract; stderr may contain a redacted diagnostic | process-specific nonzero |

The indeterminate projection is exactly:

```json
{"error":{"code":"builtin_tool.outcome_indeterminate","message":"Confirm current state before acting again.","recovery":"confirm_outcome"}}
```

It never exposes `requestId`, even though Core retains the full envelope and replay identity. Stderr must
not contain socket/context paths, process or lease tokens, binding credentials, SQL, or an unfiltered
Rust/anyhow error chain.

## 7. Replay, receipt, and evidence

Core computes receipts over the complete canonical outcome, not the projected JSON. A transport retry
and durable replay return the same complete envelope internally. The projection is recomputed only after
that envelope validates, so a compact stdout document cannot create a second effect or alter idempotency.

Evidence, Qualification, and host-controlled debug retain the complete envelope (`operation`,
`requestId`, `receipt`, and canonical result/error). No Agent-facing environment variable, hidden flag,
or `--full` option re-enables it.

## 8. Clean-break and compatibility

v0.46 does not accept v0.45 CLI command version, Agent output mode variables, `tool list/describe`,
generic invocation aliases, or old `camp.message.send` input. A supplied `campId`/`--camp-id` is
`builtin_tool.invalid_input` with `fix_input`; it is not aliased or silently translated. Old replay
records and old Rovai-owned App data are outside the contract and may be removed under the managed
reset boundary in [ADR-0118](../versions/v0.41/decisions.md#adr-0118).

Other cross-Camp read operations retain their explicit `campId` business input; this clean break is
limited to Agent-facing `camp.message.send`.

## 9. Observability metric

The implementation measures and reports the serialized-byte reduction from the complete Agent envelope for
diagnostics and release notes. No minimum percentage is a release gate. Release correctness is decided
by envelope validation, closed operation schemas/golden fixtures, safe error handling, and retention of
business information.

## References

- [ADR-0135: Compact Agent Output over Canonical Built-in Tool Envelope](../versions/v0.46/decisions.md#adr-0135)
- [Camp Message Send v2](camp-message-send-v2.md)
- [Built-in Tool Transport v2 (historical)](builtin-tool-transport-v2.md)
- [ADR-0124: CLI-Only Transport for Rovai Built-in Operations](../versions/v0.42/decisions.md#adr-0124)
- [v0.46 implementation plan](../versions/v0.46/implementation-plan.md)
