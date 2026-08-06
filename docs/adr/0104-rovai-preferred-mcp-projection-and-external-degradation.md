---
document_type: adr
id: ADR-0104
title: Rovai-Preferred MCP Projection and Non-Blocking External Degradation
status: superseded
date: 2026-08-04
decision_scope: cross-version
source_version: v0.37
supersedes: []
superseded_by: ADR-0125
---

# ADR-0104: Rovai-Preferred MCP Projection and Non-Blocking External Degradation

> 本决策已由 [ADR-0125](0125-runtime-native-additive-external-mcp-projection.md) 替代。

> 后续 Codex 专项规范：[ADR-0107](0107-camp-member-isolated-codex-home-and-agentrun-app-server.md)
> 以 Camp/AgentProfile 隔离 `CODEX_HOME` 和逐 AgentRun app-server 替代 Codex whole-table
> override 的 ambient 隔离假设；本文的同名 Rovai 优先、frozen input 和单次外部降级语义
> 继续有效。

## Context

Rovai projects a frozen external MCP set into several Runtime CLIs while those Runtimes may also
discover user, project, plugin or built-in MCP Servers. A same-named native Server must not silently
win over the Server the user enabled and assigned in Rovai. Rejecting the AgentRun solely because
of that collision is also unnecessary when an Adapter can disable, override or privately alias the
native entry.

Earlier policy also treated unsupported external projection as an AgentRun admission failure.
External MCP is an optional capability rather than the base execution engine: invalid connection
data, a missing environment value or a Runtime flag regression should be visible and frozen, but
must not prevent the member's new AgentRun from starting without external MCP. Internal Team
Gateway attachment remains a separate capability and must not be disabled merely because external
projection degrades.

## Decision

### Canonical precedence across every Adapter

For Codex, Claude Code, OpenCode, Copilot, Kiro, Qoder, CodeBuddy and Qwen Code, a Server requested
by the AgentRun's Rovai projection has precedence over every Runtime-native Server with the same
case-insensitive canonical name. The Adapter must use a Runtime-native mechanism such as strict
private configuration, complete override, explicit native disablement or a temporary private alias
to ensure the Rovai definition is the one actually available.

If an alias is required, it is Adapter-private and frozen with a canonical-name to Runtime-name
mapping. It is never written to `mcp.json`, never changes Server identity and is shown only in
diagnostics, recovery evidence or model instructions required to use the projected name.

An Adapter never mutates a Runtime's user or project configuration. Read-only discovery may inform
collision handling, but every override is carried by process arguments, a private configuration
environment or Rovai-owned `0600` temporary files. Non-conflicting native MCP treatment continues
to follow that Adapter's declared ambient-isolation policy.

The same precedence applies to the reserved internal `rovai_team` name, while External MCP
Projection and Team Gateway Attachment remain independent capability axes.

### Unsupported means explicit external degradation

When an Adapter cannot reliably prove Rovai precedence and its declared isolation semantics, its
external MCP capability is unsupported. It must not report success, use a same-named native Server
or fail an AgentRun merely because a requested external Server is unavailable.

AgentRun creation freezes one MCP Projection Input containing definitions, enablement, Assignments,
resolved environment values and canonical configuration digest. The Runtime startup derives only
from this frozen input:

- a definition-local environment, cwd or transport failure excludes that Server only;
- an invalid whole canonical file or unsupported exact projection produces an empty external
  projection;
- every omission records a typed degradation reason and is never described to the model as an
  available tool;
- Team Gateway preparation proceeds independently under its own capability and safety protocol.

If a Runtime at or above the Adapter's necessary minimum version explicitly rejects the normal
external MCP configuration or flags during startup, the Adapter may record the rejection and retry
exactly once without user external MCP. The retry uses the same frozen Projection Input and does not
reread `mcp.json`. Non-MCP startup failures do not use this fallback.

After a Runtime Session starts successfully, Core seals the final MCP Exposure Snapshot containing
requested Servers, projected Servers, canonical/runtime name mapping and every degradation reason.
Recovery reuses that final private projection; only a later AgentRun evaluates newer canonical
state.

### Compatibility and evidence

Adapters declare only the first Runtime version known to support their required official mechanism.
There is no acceptance upper bound: newer versions continue attempting the same path and degrade
only on observed rejection. User machines are not subjected to synthetic test Sessions or live MCP
probes from the settings page.

Development acceptance uses real Runtime CLIs and real MCP protocol Servers. Same-name smoke tests
must distinguish a native marker from a Rovai marker and call the projected tool. Context7 and
Playwright default smokes use their real connection paths; missing optional external credentials
produce an explicit unverified result rather than a mock success.

## Consequences

- Same-name collisions have one predictable semantic across all supported Runtime Adapters.
- Members can still work when optional external MCP configuration is invalid or temporarily
  unsupported, with precise frozen diagnostics instead of a misleading fallback.
- Adapters need richer private projection evidence, canonical/runtime name maps and a bounded
  MCP-specific startup fallback.
- Runtime upgrades do not require arbitrary maximum-version churn, but incompatible changes become
  observable degraded Runs until the Adapter is updated.
- Settings status can describe readiness and last frozen projection without contacting third-party
  Servers or claiming online state.

## Rejected Alternatives

- Let the Runtime choose between same-named entries: rejected because the user could silently
  receive a different tool authority than the Rovai Assignment.
- Fail every collided or unsupported AgentRun: rejected because external MCP is optional and the
  base Runtime can continue honestly without it.
- Fall back to the native same-named Server: rejected because matching names do not prove matching
  configuration, credentials, permissions or tool behavior.
- Mutate the user's Runtime configuration: rejected because it crosses ownership boundaries and
  makes cleanup, concurrent launches and crash recovery unsafe.
- Add maximum accepted Runtime versions: rejected because an untested newer version is not itself
  evidence of incompatibility.
- Probe or smoke MCP Servers on user machines: rejected because the settings page is not an
  execution or trust boundary and should not create external side effects.

## References

- [v0.37 MCP Configuration and Projection](../versions/v0.37/README.md)
- [ADR-0018: File-Backed MCP Library and Per-Run Runtime Projection](0018-file-backed-mcp-library-runtime-projection.md)
- [ADR-0065: Verified Runtime Catalog](0065-verified-runtime-catalog-and-documentation-only-compatibility.md)
- [ADR-0088: Attested Native Team Gateway Attachment](0088-attested-native-team-gateway-attachment.md)
