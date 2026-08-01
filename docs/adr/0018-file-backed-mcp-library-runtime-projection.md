---
document_type: adr
id: ADR-0018
title: "File-Backed MCP Library and Per-Run Runtime Projection"
status: accepted
date: 2026-07-24
decision_scope: cross-version
source_version: v0.09
supersedes: []
superseded_by: null
---

# ADR-0018: File-Backed MCP Library and Per-Run Runtime Projection

> 后续局部规范：[ADR-0088](0088-attested-native-team-gateway-attachment.md) 将内部 Team
> Gateway attachment 与用户管理的外部 MCP 投影拆为独立能力。本文的外部 MCP 真源、
> Assignment、逐 Run 精确投影和 Unsupported 边界继续有效。

## Context

Lumen needs to let users manage external MCP Servers once and make selected Servers available to
multiple locally installed Agent Runtimes. Codex, Claude Code, OpenCode, Copilot and Antigravity
use different local configuration formats and process/session mechanisms. Lumen also has an
internal Team MCP whose authenticated tools are part of the collaboration control plane rather
than user-managed external configuration.

Treating MCP definitions as SQLite business entities would duplicate the local-file configuration
model already used by Agent tools and create a second representation solely for a small settings
feature. Conversely, letting each Runtime read its personal configuration would bypass Lumen's
per-Member assignments and leak MCPs that the user did not select for an AgentRun.

MCP configuration can contain secrets, while AgentRun recovery requires the execution environment
to remain stable after the user edits the source file. A central MCP Proxy could make permission
and audit behavior uniform, but would also make Lumen responsible for protocol transport,
connection lifecycle, OAuth, tool routing and every external side effect.

## Decision

### File-backed canonical configuration

`~/.lumen/mcp.json` is the only source of truth for user-managed external MCP Server definitions,
enablement and AgentProfile assignments. Lumen does not create MCP Server or Assignment tables in
SQLite.

The file uses a versioned, strict Lumen schema for Stdio and Streamable HTTP. Lumen writes it with
current-user-only permissions and atomic replacement. The settings UI is a graphical editor over
that file. External edits are supported through reread and Digest Compare-and-Set; malformed
content is preserved and never overwritten with an empty configuration.

Lumen does not install any third-party MCP by default. Importers read known Runtime user-level
configuration as transient candidates and copy only user-confirmed portable definitions. Import
does not mutate or synchronize the source and does not copy OAuth state or plaintext credentials.

### Explicit Member scope

External MCP definitions are application-global, but exposure is explicitly assigned to
AgentProfiles. Import defaults to all currently active AgentProfiles while materializing concrete
assignments; future Agents do not receive silent authority. Camp, Project and Task scopes are not
inferred.

The internal `lumen_team` Server is reserved, fixed and excluded from the MCP Library. It continues
to follow its own Capability, Binding Credential and Execution Epoch protocol.

### Per-AgentRun projection

At AgentRun start, Lumen resolves enabled and assigned definitions against current Adapter
capabilities and environment, then freezes an MCP Exposure Snapshot. The Adapter translates that
snapshot into an immutable private Runtime-native projection containing the selected external
Servers plus Team MCP.

The Agent CLI remains the MCP Client: it launches Stdio Servers or connects to HTTP Servers.
Lumen drives the exact per-run list and does not rely on Runtime personal MCP configuration.
Adapters that cannot isolate and inject the list report unsupported rather than leaking personal
MCPs.

Running AgentRuns do not hot-switch. Crash recovery reuses the original private projection; it
does not rebuild from a modified canonical file. Projections may contain resolved credentials,
are stored with current-user-only permissions, and are removed after the Run becomes terminal.
SQLite Context/Runtime records contain only redacted exposure metadata and digests.

MCP changes affect later AgentRuns without invalidating the Conversation or Native Session.
Adapters may restart transient hosts while resuming the same external Session identity.

### Execution and permission boundary

Lumen does not act as a general external MCP Proxy. Runtime-native permission behavior remains
authoritative unless an Adapter exposes a reliable pre-execution callback that can enter Lumen's
existing Action/Approval protocol. UI and audit surfaces must identify the actual control level
and must not claim Core approval when only Runtime-native control exists.

## Consequences

- Users get one inspectable Lumen configuration without dual SQLite/JSON truth.
- Runtime configuration remains isolated per Agent and AgentRun rather than leaking personal MCPs.
- Existing Native Sessions survive MCP configuration changes.
- Deterministic Run recovery requires short-lived private copies of projected secrets.
- Lumen must implement strict redaction, file permissions, atomic writes and orphan cleanup.
- Each Adapter must prove exact per-run injection; unsupported Runtimes receive no simulated
  fallback.
- Permission guarantees remain Adapter-dependent because Lumen does not proxy every call.
- Tool-level cross-Runtime filtering and OAuth remain future, separately justified capabilities.

## Rejected Alternatives

- SQLite MCP Server/Assignment tables as canonical state: rejected as unnecessary duplicate
  configuration truth.
- Treating Runtime user configuration as live truth: rejected because it bypasses Member scope and
  changes outside Lumen would silently affect Runs.
- Continuous synchronization or write-back: rejected because conflicts, credentials and ownership
  are not portable.
- Installing default Context7: rejected because Lumen should not choose a third-party trust
  relationship for the user.
- Project-level config projection: rejected because it dirties or mutates user workspaces and
  cannot enforce per-Agent scope in a shared root.
- Rebuilding Native Sessions after every MCP change: rejected because current Runtimes can receive
  per-run configuration while resuming existing Sessions.
- Central external MCP Proxy: rejected because it expands configuration management into protocol,
  credential and side-effect ownership.
- Silent removal of source Tool Filters: rejected because it can expand authority.

## References

- [v0.09 MCP Library](../versions/v0.09/README.md)
- [v0.09 架构与协议](../versions/v0.09/architecture.md)
- [ADR-0009: Reproducible Context Materialization and Delivery](0009-reproducible-context-delivery.md)
- [ADR-0014: Stable Team Tool Gateway v2](0014-stable-team-tool-gateway-v2.md)
- [ADR-0015: Action and Safety v2](0015-action-safety-v2.md)
- [ADR-0016: Multi-Runtime Execution Boundary v2](0016-multi-runtime-execution-v2.md)
