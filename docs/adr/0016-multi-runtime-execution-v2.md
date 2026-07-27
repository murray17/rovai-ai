---
document_type: adr
id: ADR-0016
title: "Multi-Runtime Execution Boundary v2"
status: accepted
date: 2026-07-23
decision_scope: cross-version
source_version: v0.06
supersedes: [ADR-0003, ADR-0006]
superseded_by: null
---

# ADR-0016: Multi-Runtime Execution Boundary v2

## Context

ADR-0003 established Conversation-scoped Native Binding, AgentRun execution epochs, Host/event fencing and recoverable Runtime scheduling, but described a Codex-centered topology, fixed version matrix and an unresolved RT-02 input policy.

ADR-0006 introduced `AgentRuntimeAdapter` and multiple locally installed CLI products, but its built-in list predates Claude Code support and still names the Antigravity integration as an `agy` product Adapter rather than Antigravity App with a companion process. ADR-0009 has since closed RT-02 with immutable ContextManifest delivery, and current Adapter support is discovered from the user's installed tools rather than fixed versions.

This ADR replaces ADR-0003 and ADR-0006 in full. It preserves their execution safety and Adapter abstraction while defining the current multi-Runtime boundary from one source.

## Decision

### Domain/runtime boundary

Rust Core exposes one Coding Agent Runtime abstraction named `AgentRuntimeAdapter`. There is no second public `AgentAdapter` interface.

Domain code owns Camp, Conversation, AgentRun, Action/Approval, context manifests and authoritative state transitions. An Adapter:

- discovers a local installation and authentication availability;
- reports observed capabilities, models and native configuration options;
- validates and freezes the configuration selected for one AgentRun;
- translates Provider protocol events and requests into closed Core commands;
- owns its Host/process, Native Session, Resume, interrupt and cleanup strategy.

Core never depends directly on an App Server, ACP or CLI-output protocol type. Shared protocol clients are implementation libraries, not product Adapter identities.

### Built-in Adapters

The current built-in registry contains:

```text
AgentRuntimeAdapter
├── CodexCliRuntimeAdapter       → Codex App Server / Native Thread
├── OpenCodeCliRuntimeAdapter    → typed ACP client
├── CopilotCliRuntimeAdapter     → typed ACP client
├── ClaudeCodeCliRuntimeAdapter  → Claude Code CLI Session/JSON protocol
└── AntigravityAppRuntimeAdapter → local agy companion process
```

OpenCode and Copilot may share ACP transport code but remain distinct Adapters with separate capability, permission and lifecycle semantics. Antigravity App is the product-facing Adapter kind; `agy` is only its local companion launch mechanism and legacy discovery alias.

The registry is compiled into Lumen. Dynamic third-party Adapter loading requires a future ADR covering trust, compatibility, upgrade and sandbox boundaries.

### AdapterInstallation and Agent configuration

`AdapterInstallation` is an application-level shared launch target identified by Adapter kind, stable executable/launch identity and configuration/authentication scope. Multiple AgentProfiles may use one Installation while keeping independent model and native permission preferences.

Installation discovery records the current executable fingerprint/version as observation, not as a version lock. Each launch or explicit refresh revalidates the actual installation and capabilities. Lumen does not restrict supported Agents to versions tested during development.

AgentProfile defaults, optional Conversation overrides and AgentRun-frozen configuration remain separate:

```text
AgentProfile defaults
→ Conversation explicit override
→ resolve and validate current Installation capabilities
→ freeze actual configuration on AgentRun
```

Later profile, model, permission or installation changes never rewrite an existing Run.

### Host and process topology

`AgentRuntimeHostManager` and `AgentRuntimeHost` are Adapter-internal lifecycle components, not domain entities or a required one-process-per-Conversation topology.

An Adapter may use a shared compatible Host, a bounded pool, one Host per Run or a short-lived process according to its verified protocol. Reuse keys include every Host-level value that could leak account, configuration, MCP or environment state. Run/Thread-level cwd, Workspace, model, permissions, Charter and tools must never cross bindings.

Codex can reuse compatible App Server Hosts with multiple Native Threads. OpenCode and Copilot may use isolated ACP Hosts where dynamic configuration cannot safely share. Claude Code and Antigravity use their verified CLI/session process strategies. These are implementation policies, not persistent collaboration invariants.

### Native Binding, scheduling and fencing

A Conversation persists one current Native Binding:

```ts
type NativeBinding = {
  adapterInstallationId: string;
  nativeSessionId: string;
  bindingCompatibilityDigest: string;
  generation: number;
};
```

The runtime registry maps Provider-native Session/Thread/Turn identifiers to Conversation, active AgentRun and `executionEpoch`. A Runtime event or Tool call may enter a domain command only when Host/process identity, Native Binding generation, Native Turn, AgentRun and epoch resolve uniquely.

One Conversation has at most one current running or waiting AgentRun. Different Conversations may execute concurrently when the selected Adapters and Hosts support it. A new execution lease increments the epoch; stale Host, Session, Turn, callback and Tool identities fail closed.

No token output is proof of idle state. A Host/Run is reclaimable only after Native Turn, reverse requests, Tool calls, Runtime deliveries, Approval/Action results and cancellation facts are terminal or durably recoverable.

### Input and Session continuity

Every AgentRun consumes its unique immutable ContextManifest under ADR-0049. RT-02 is closed: retry/recovery of the same Run uses the same frozen Lumen payload and never reassembles a semantically similar prompt from newer database state.

Adapter System Prompt remains upstream-owned. Lumen appends compatible Session Charter content when supported and otherwise puts it in the first frozen payload without replacing the upstream prompt. New Native Sessions Bootstrap from Lumen-owned portable context; Resume uses the current compatible binding.

Switching Adapter Installation or any configuration included in `bindingCompatibilityDigest` preserves Conversation identity but requires prepare-then-CAS replacement of the Native Session. Lumen does not migrate Provider-hidden reasoning, private compression or undisclosed tool state.

### Recovery

Recovery proceeds from authoritative state:

```text
fence failed Host/process and old epoch
→ preserve or derive the Run's real waiting reason
→ reconcile Approval, Action and Runtime delivery
→ prove replay safety
→ reacquire execution lease and increment epoch
→ Resume compatible Native Session or prepare-and-bind a new Session
→ continue, wait or terminate deterministically
```

Unknown external effects and uncertain input delivery are reconciled before model execution resumes. Process restart is never treated as proof that a command, prompt or effect did not occur.

### Optional capabilities

Adapter capabilities are explicit observations, not assumed lowest-common-denominator behavior. Examples include Native Session Resume, appended Charter, model discovery, structured permissions, Action interception and Team MCP injection.

Core and UI expose unsupported capabilities honestly. In particular, Codex, OpenCode, Copilot and Claude Code may advertise Team MCP only after real local discovery/Smoke; Antigravity App remains Team-Tool unsupported until its companion protocol is empirically verified.

## Consequences

- Collaboration and scheduling use one stable Adapter contract while Provider protocol details stay isolated.
- Current local Agent upgrades are recognized by discovery without changing AgentProfile or Conversation identity.
- Native Binding and epoch fencing prevent stale processes, callbacks and MCP connectors from mutating new Runs.
- Immutable ContextManifest delivery makes retry and recovery byte-stable for Lumen-owned input.
- Adapter-specific Host strategies can evolve without changing the domain model, but every reuse policy requires isolation tests.
- Unsupported features remain visible as capability gaps rather than being approximated unsafely.

## Rejected Alternatives

- A public `AgentAdapter` beside `AgentRuntimeAdapter`.
- Core depending directly on Codex App Server, ACP or CLI JSON/text output.
- Treating a shared ACP client as the OpenCode/Copilot product Adapter.
- A global Runtime Host singleton or one-process-per-Conversation domain invariant.
- Per-AgentProfile executable/installation copies and repeated authentication truth.
- Fixed CLI version allowlists as the support policy.
- Rebuilding the same AgentRun input from current database state after a crash.
- Replacing Provider System Prompt with Lumen Charter.
- Claiming Antigravity Team Tool support without a verified local protocol.
- Loading arbitrary third-party Adapter binaries before a dedicated trust-boundary ADR.

## References

- [v0.06 Team Task 协作工具](../versions/v0.06/README.md)
- [ADR-0001: Core Transaction](0001-core-transaction.md)
- [ADR-0009: Reproducible Context Materialization and Delivery](0009-reproducible-context-delivery.md)
- [ADR-0012: Collaboration v3](0012-collaboration-v3-lightweight-task.md)
- [ADR-0014: Stable Team Tool Gateway v2](0014-stable-team-tool-gateway-v2.md)
- [ADR-0015: Action and Safety v2](0015-action-safety-v2.md)
- [Superseded ADR-0003: Execution Runtime](0003-execution-runtime.md)
- [Superseded ADR-0006: Multi-Runtime Adapter Boundary](0006-multi-runtime-adapter-boundary.md)
