---
document_type: adr
id: ADR-0014
title: "Stable Team Tool Gateway v2"
status: accepted
date: 2026-07-23
decision_scope: cross-version
source_version: v0.06
supersedes: [ADR-0011]
superseded_by: null
---

# ADR-0014: Stable Team Tool Gateway v2

> 后续局部规范：[ADR-0067](0067-native-session-bootstrap-and-agentrun-context-v3.md)
> 删除 A2A Task Context 注入假设；[ADR-0068](0068-brokered-memory-retrieval-and-session-entrypoint.md)
> 与 [ADR-0069](0069-single-effective-memory-and-scope-bounded-agent-mutation.md) 在同一
> Gateway 增加 Memory read/write tools。本文其余 Gateway、Binding、鉴权与事务边界继续有效。

## Context

ADR-0011 established an App-lifetime local Team Tool Gateway, stateless Provider-launched MCP connectors and credentials bound to Native Binding rather than AgentRun. That topology solved Native Session reuse and stale per-Run connector credentials and remains correct.

ADR-0011 also fixed `team.post_message` as the only Team tool. Lumen now needs Agents to create, update and query lightweight Camp Tasks without opening a second MCP server or duplicating authorization. The new tools must use the same current-Run identity, execution fencing and command idempotency while preserving the rule that Task changes do not start Agent work.

This ADR replaces ADR-0011 in full and generalizes its stable gateway from one A2A tool to the current Team MCP tool set.

## Decision

### Stable gateway and replaceable connectors

Lumen Core starts one Team Tool Gateway for the App process lifetime on a permission-restricted local Unix Socket. It is the trusted entry point, current-identity resolver and authorization boundary for all Team MCP tools.

Codex, OpenCode, Copilot and Claude Code may start one or more stateless MCP stdio connectors according to their Host or Native Session lifecycle. A connector only translates MCP stdio to authenticated Core IPC. It does not read SQLite, retain domain state, decide permissions or become a queue.

Repeated connector startup, Provider-side MCP deduplication and Native Session reuse must not change tool semantics.

### Native Binding credential

Connector credentials bind to `(nativeBindingId, nativeBindingGeneration)`, not AgentRun. Re-preparing the same valid Binding during one Core process yields compatible credentials; Core restart, rebind or generation change invalidates prior credentials.

Every invocation dynamically resolves:

```text
Native Binding
→ Conversation
→ exactly one current running AgentRun
→ executionEpoch
→ CampTurn / optional Task
→ AgentProfile + CampMember
→ effective Capability
```

Missing or ambiguous current Run, stale Binding/Generation/Epoch, terminal or cancelled Run, inactive membership and insufficient Capability fail closed. Connector credentials prove only the Binding; they never freeze a previous Run's authority.

`CampTurn.status` is an aggregate lifecycle state, not the sender's execution authority. A current
`running` AgentRun may continue using Team MCP while its non-cancelled CampTurn is `running` or
`waiting`; the latter can mean another responsibility in the same Turn is blocked on approval.
The sender Run itself must still be `running`, current-epoch and uncancelled.

### Team MCP tool set

The Team MCP exposes:

```text
team.post_message
team.create_task
team.update_task
team.list_tasks
```

There is no separate Task MCP, secondary socket or independent credential.

`team.post_message` remains an execution request to one other active CampMember. Its model-controlled arguments remain recipient, body, optional reply linkage and allowed generic references. It does not accept `taskId`. Core derives sender, Camp, source Run/Epoch, CampTurn, correlation and idempotency. Success atomically creates InboxMessage, target ConversationMessage, delivery ACK, target queued AgentRun and audit events. The target Run does not inherit the source Run's optional Task association; the A2A body and authorized Task Context carry collaboration context. Tool success means accepted for execution, not target completion.

`team.create_task` accepts title, optional description and optional Assignee. It creates one `pending` Task and never creates a message, Inbox delivery or AgentRun.

`team.update_task` accepts Task ID, expected version and a non-empty patch over title, description, status and Assignee. Omitted fields remain unchanged; a null Assignee releases the Task. The whole patch succeeds atomically or not at all.

`team.list_tasks` is an authenticated Read Side query with optional status, Assignee, limit and opaque pagination cursor filters. It returns only the caller's authorized scope, complete Task details, current version, available operations and explicit truncation/pagination information. It does not require a separate read Capability.

Models never provide `campId`, Actor, AgentRun, Epoch, command identity, Capability or idempotency key. The Gateway derives them from the Binding and Runtime tool-call identity. Unknown input fields fail schema validation.

### Authorization and scope

Tool discovery does not grant authority. `team.post_message` requires its A2A Capability and existing loop/target quotas. `team.create_task` requires `task.create`; `team.update_task` requires `task.update` plus the Task relationship rules from ADR-0012.

Every active AgentProfile defaults to `task.create` and `task.update`, subject to CampMember overrides. Default Lead reads every Camp Task but receives no additional Task write authority.

Task query scope is:

```text
Default Lead → all Camp Tasks
ordinary member → assigned-to-self + unassigned Tasks
```

Visibility is enforced before filters and pagination. Guessed IDs, Assignee filters and stale cached versions cannot reveal or mutate another member's hidden Task.

### Idempotency and transactions

Task writes and A2A delivery use the static typed `DomainCommandGateway` from ADR-0001. Runtime tool-call identity contributes to stable command identity and request digest. A repeated semantically identical write returns its persisted `command.result`; it does not create another Task, event, message or AgentRun.

The same command identity with different semantic input returns `idempotency_conflict`. Transactions contain only SQLite reads/writes and audit events; post-commit wakeups remain best effort and recoverable from authoritative object state.

`team.list_tasks` is read-only and does not create command results or events merely because the model queried it.

### Charter and Tool Schema

Core embeds `crates/rovai-core/resources/charter-team-tools.md` at build time. When a supported Adapter successfully binds Team MCP, Core appends that resource to the new Native Session Charter without replacing the Provider System Prompt.

The resource explains Task versus A2A use, visibility and completion semantics. It does not duplicate JSON Schema. MCP Tool Schema is the unique source for parameter names, required fields and types.

The embedded content participates in Charter Compatibility Digest. A semantic Charter change invalidates the old Native Session binding so the next Session receives the current contract; resuming the same compatible Session never repeats the Charter.

### Adapter surface

MCP configuration is appended to Provider-native configuration and does not replace user MCP or upstream prompts:

- Codex CLI uses its App Server/Native Thread MCP configuration;
- OpenCode CLI uses ACP Session MCP configuration;
- Copilot CLI uses its isolated ACP Host configuration;
- Claude Code CLI passes the private MCP config for print/resume and pre-authorizes only the Lumen Team tools.

Adapter availability is determined from the currently discovered local installation and capability probe rather than a fixed version whitelist.

Antigravity App remains unable to advertise or consume Team MCP until its local companion integration is empirically verified. It may execute ordinary Runs, but it is neither A2A-capable nor Task-Team-Tool-capable merely because an AgentProfile references it.

## Consequences

- One trusted local gateway serves A2A and Task collaboration without duplicated credentials, dispatchers or MCP configuration.
- Native Session reuse remains safe because authorization resolves the current Run on every call.
- Agents gain durable Task coordination while Task writes remain side-effect free with respect to Runtime scheduling.
- Read visibility and write Capability are independently enforced, so Default Lead can coordinate without becoming an administrator.
- Tool Schema, Charter prose and Core commands need coordinated versioning and contract tests.
- Providers without verified Team MCP support cannot use Task tools even though their Agents may still participate through user-driven Runs.

## Rejected Alternatives

- A separate Task MCP server: rejected because it duplicates topology, credentials and Adapter injection.
- Per-AgentRun connector credentials: rejected because Providers may reuse the MCP process across Runs in one Native Session.
- Supplying `agentRunId`, `executionEpoch` or `campId` as model arguments: rejected because the model is not an authority source.
- Adding `taskId` to `team.post_message`: rejected because Task responsibility and AgentRun execution remain decoupled.
- Copying the source Run's Task association into every A2A target Run: rejected because the request may concern a newly created or entirely different Task and responsibility does not transfer.
- Waking the Assignee from `team.create_task` or `team.update_task`: rejected because Task mutation is not an execution command.
- Treating tool visibility as Capability: rejected because prompts and schemas are not security boundaries.
- Copying JSON Schema into Charter Markdown: rejected because parallel definitions drift.
- Claiming unsupported Antigravity Team Tool integration: rejected until local protocol verification succeeds.

## References

- [v0.06 Team Task 协作工具](../versions/v0.06/README.md)
- [ADR-0001: Core Transaction](0001-core-transaction.md)
- [ADR-0016: Multi-Runtime Execution Boundary v2](0016-multi-runtime-execution-v2.md)
- [ADR-0009: Reproducible Context Materialization and Delivery](0009-reproducible-context-delivery.md)
- [ADR-0012: Collaboration v3](0012-collaboration-v3-lightweight-task.md)
- [Superseded ADR-0011: Stable Team Tool Gateway](0011-stable-team-tool-gateway.md)
