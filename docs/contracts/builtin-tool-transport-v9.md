---
document_type: contract
contract: builtin-tool-transport-v9
status: accepted
target_version: v0.73
last_updated: 2026-08-13
---

# Built-in Tool Transport v9

v9 inherits v8's Unix IPC, complete Core Envelope, receipt, Replay, Agent Output v2, process-scoped lease, single-JSON
stdout, Camp Message Send v5, Task v3, exact Camp addressing and progressive teaching. It changes only the fixed Memory
command set, `memory.write` schema/output and the catalog/Session rollout required by that change.

## Fixed commands and versions

```text
rovai send
rovai task create|get|update|list
rovai camp list|search|read
rovai history search
rovai memory search|read|write
```

The fixed set contains twelve business commands. `rovai memory propose-hearth` and canonical operation
`memory.propose_hearth` do not exist in v9 Agent catalog, root help, exact help, Bootstrap, Skills or schemas.

```text
BUILTIN_TOOL_CONTRACT_VERSION = 9
BUILTIN_TOOL_CLI_COMMAND_VERSION = 9
Runtime capability = builtin_cli.transport.v9
```

v8 and earlier cannot satisfy v9 catalog/capability identity. IPC protocol, Core Envelope version, receipt version and
Agent Output version remain unchanged.

## `memory.write`

Input is the closed add/revise union in [Memory Capture v1](memory-capture-v1.md). The operation-specific Core handler
routes by authenticated target Scope:

```text
Companion / permitted directed Relationship -> effective formal Memory/Revision
Hearth                                      -> pending Hearth Review Item
```

Successful Agent projection is exactly one union member:

```json
{"outcome":"effective","memoryId":"memory_123","revisionId":"revision_456"}
```

```json
{"outcome":"review_pending","reviewItemId":"review_789"}
```

Both schemas use `additionalProperties: false`. `effective` requires both formal IDs and forbids `reviewItemId`;
`review_pending` requires `reviewItemId` and forbids formal IDs. `effective: false`, proposal status, operation,
requestId, receipt and Envelope fields are not Agent output.

Business failure remains `{"error":{"code","message","recovery"}}`. `memory.duplicate_pending` returns no existing
Review Item ID, candidate metadata or count. Revision and Review version conflicts use `refresh_then_decide`; CLI does
not automatically repeat a stale mutation.

## Exact help and teaching

The v9 exact-help set is:

```text
rovai --help
rovai send --help
rovai task create --help
rovai task get --help
rovai task list --help
rovai task update --help
rovai camp list --help
rovai camp search --help
rovai camp read --help
rovai history search --help
rovai memory search --help
rovai memory read --help
rovai memory write --help
```

There is no `rovai memory --help` teaching alias. Root help names only the three Memory operations. Exact write help
states that Hearth produces `review_pending`, not an effective Memory; it points long governance judgment to the
system-required `memory-stewardship` Skill without embedding that Skill's full decision tree.

`memory-stewardship` uses only search/read/write examples, makes natural-language discovery explicitly best-effort,
allows Agent Relationship mutation only for `directed(current Agent -> counterparty)`, and tells the Agent to describe
the two successful outcomes accurately. `cli-operations` lists the same fixed commands but does not duplicate Memory
governance.

Session Charter owns the fixed command set, exact-help rule, input-source rule, compact-output rule and recovery
principles. It gains no Memory opportunity checklist or deterministic Skill-loading claim. Existing Memory Entrypoint
Bootstrap remains independent.

## Catalog, process and Native Session rollout

The catalog has one `memory.write` input schema, canonical result schema, closed `agentOutputSchema`, projection
identity and golden fixture for each union member. Removing `memory.propose_hearth` changes the catalog digest even
though IPC/Envelope versions do not change.

Antigravity binding compatibility already includes Built-in Tool contract version and catalog digest, so v8 cannot
resume as v9-compatible. Other Runtime adapters retain the accepted rule that Charter prose alone does not globally
discard useful Native Sessions; every acquired Run nevertheless preflights current v9 CLI/context/capability before
input delivery. Newly created Native Sessions receive the v9 Charter. Existing Bootstrap Evidence is immutable.

No App process or AgentRun exposes mixed v8/v9 commands, a compatibility alias, hidden `propose-hearth`, or fallback
MCP transport.

## Qualification

Deterministic transport tests cover catalog count/digest, exact help, all three input sources, closed input/output,
Envelope projection, Replay, lease/fence, body-free errors and removal of every old command route.

Before v0.73 completion, each of Codex CLI, Claude Code, OpenCode, GitHub Copilot CLI, Kiro CLI, Qoder CLI, CodeBuddy,
Qwen Code and Antigravity must demonstrate with a real model:

- discovery of exact Memory help;
- one permitted direct write reported as `effective`;
- one Hearth submission reported as `review_pending` without claiming activation;
- one conflict followed by read-and-decide rather than blind retry;
- no selection or attempted use of the removed proposal command.

Skill opportunity-quality cases are recorded separately from transport correctness. A bounded smoke can improve the
description, but its evidence must not be rewritten as deterministic natural-language intent handling.

## Unchanged v8 rules

Camp Message Send v5, Current User Attention, Task, Camp/History read shapes, input-source mutual exclusion, CLI local
errors, Core Envelope, receipt, Replay, transport retry, `confirm_outcome`, full host evidence, process lease, current
Camp derivation and external MCP boundaries remain exactly as v8. Non-help execution writes one JSON document to
stdout and never exposes credentials, socket/context paths, request identity or the full Envelope.

## References

- [Memory Capture v1](memory-capture-v1.md)
- [Built-in Tool Transport v8 (historical)](builtin-tool-transport-v8.md)
- [Camp Message Send v5](camp-message-send-v5.md)
- [ADR-0124](../versions/v0.42/decisions.md#adr-0124)
- [ADR-0135](../versions/v0.46/decisions.md#adr-0135)
- [ADR-0180](../versions/v0.73/decisions.md#adr-0180)
- [Built-in Tool Runtime architecture](../architecture/builtin-tool-runtime.md)
- [Online Memory Capture architecture](../architecture/online-memory-capture.md)
