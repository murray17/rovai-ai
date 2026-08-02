---
document_type: adr
id: ADR-0089
title: "Attested Built-in MCP Tool Parity"
status: accepted
date: 2026-08-02
decision_scope: cross-version
source_version: v0.31
supersedes: []
superseded_by: null
---

# ADR-0089: Attested Built-in MCP Tool Parity

## Context

[ADR-0088](0088-attested-native-team-gateway-attachment.md) established a credentialless,
OS-attested MCP attachment for Runtimes that can launch native MCP but cannot prove an exact
per-Run replacement of their ambient MCP set. Its first Antigravity implementation intentionally
exposed only `post_message` while process proof, configuration ownership, exact permission and
real model invocation were validated.

Rovai's credentialed built-in Gateway already exposes thirteen Team, Context Retrieval and Memory
operations through one authenticated Native Binding. Keeping an otherwise execution-capable Runtime
on a permanent `post_message` subset makes the Agent's collaboration and memory ability depend on
the transport used to attach the same Core-owned Gateway. It also makes a default team qualification
measure a known Adapter omission rather than the configured Member's actual business authority.

The attested path can reuse the same Core handler and live authorization boundary. The remaining
trade-off is how to provide full semantic parity without reintroducing dotted-name incompatibility,
global permission bypass, ambient-MCP claims, or a second copy of domain logic.

## Decision

### One canonical built-in catalog

Every `AttestedNativeBridge` attachment MUST expose the complete current built-in MCP catalog that
an exact-injection Runtime receives. The v0.31 catalog is the following closed set:

| Canonical Core operation | Antigravity-visible alias |
|---|---|
| `team.post_message` | `post_message` |
| `team.create_task` | `create_task` |
| `team.update_task` | `update_task` |
| `team.list_tasks` | `list_tasks` |
| `context.search` | `context_search` |
| `context.get_message` | `context_get_message` |
| `context.get_message_window` | `context_get_message_window` |
| `context.get_message_thread` | `context_get_message_thread` |
| `context.get_summary` | `context_get_summary` |
| `memory.search` | `memory_search` |
| `memory.read` | `memory_read` |
| `memory.write` | `memory_write` |
| `memory.propose_hearth` | `memory_propose_hearth` |

The canonical catalog, schemas, output contracts and receipt identities have one Core-owned source.
The attested Bridge MAY translate canonical names into an Adapter-safe native dialect, but MUST NOT
fork schemas, descriptions, pagination, quotas, error codes, Memory rules, Task rules or result
shapes. Future additions to the built-in catalog are not considered ready on an attested Runtime
until their alias, exact permission, real discovery, real call and negative-path evidence have been
validated together.

Alias names exist only at the Runtime MCP and permission boundary. The Bridge selects the canonical
operation from a closed mapping; the model cannot submit or override a canonical name. Structured
receipts, command identity, idempotency, audit and execution evidence continue to use the canonical
operation.

### Discovery proves attachment, not authority

An unbound Bridge returns an empty `tools/list`. A Bridge bound to a current attested AgentRun and a
ready complete permission bundle returns the same thirteen semantic operations as an exact-injection
Runtime. Tool discovery does not grant domain authority.

Every `tools/call` MUST reacquire and validate the connection-bound attested lease and resolve the
current AgentRun, Native Binding, generation and Execution Epoch. The Core handler then applies the
same per-operation checks used by credentialed attachments, including:

- present Camp membership, current Run fencing and operation idempotency;
- A2A target and CampTurn depth/run quotas for `team.post_message`;
- Task visibility, business Capability and optimistic version checks;
- the frozen context boundary for every Context Retrieval read;
- current Memory applicability, lifecycle, policy, Capability, scope, quota and secret filtering.

The attested identity MAY authorize the prepared Binding associated with that exact active Run, but
it cannot be generalized into a reusable bearer credential. All thirteen operations converge on the
existing Core Gateway handler; neither the Bridge nor the Adapter may read SQLite or implement a
parallel authorization path.

Built-in MCP Tool Parity means transport and semantic parity, not equal business authority for every
Member. A Member lacking a mutation Capability receives the same structured denial it would receive
through any other Runtime.

### Exact permission is a complete user-consented bundle

Rovai manages one explicit permission bundle containing the thirteen exact rules:

```text
mcp(rovai_team/post_message)
mcp(rovai_team/create_task)
mcp(rovai_team/update_task)
mcp(rovai_team/list_tasks)
mcp(rovai_team/context_search)
mcp(rovai_team/context_get_message)
mcp(rovai_team/context_get_message_window)
mcp(rovai_team/context_get_message_thread)
mcp(rovai_team/context_get_summary)
mcp(rovai_team/memory_search)
mcp(rovai_team/memory_read)
mcp(rovai_team/memory_write)
mcp(rovai_team/memory_propose_hearth)
```

The user consents to this built-in bundle separately from installing the credentialless Plugin.
Rovai MUST apply the same ownership record, full-file compare-and-swap, crash journal, unknown-field
preservation and conflict behavior required by ADR-0088. A missing, denied, shadowed or divergent
rule makes complete parity unavailable; it MUST NOT be reported as a ready full built-in attachment.

Rovai does not enable `dangerously-skip-permissions` or another global auto-approval mode to obtain
parity. User-owned broader permission settings remain user-owned and cannot substitute for evidence
that the managed exact bundle is complete.

### Tool contract participates in Session compatibility

The canonical catalog digest, Adapter alias-map version, input/output schema digest, Bridge protocol
and build identity, permission-bundle version and corresponding Charter content participate in the
Native Session compatibility identity. Moving from the v0.30 single-tool contract to the complete
catalog requires a new compatible Native Binding; an existing Session is never hot-upgraded to a
different tool contract.

Adapter capability reporting distinguishes full built-in parity from external MCP projection and
ambient isolation. Antigravity can therefore report:

```text
ExternalMcpProjection = Unsupported
TeamGatewayAttachment = AttestedNativeBridge
AmbientMcpIsolation   = PreservedUncontrolled
BuiltInMcpToolParity  = Complete
```

This does not allow assigned external MCP to be silently ignored and does not claim that Rovai can
enumerate or remove Antigravity's ambient MCP.

### Real evidence gates readiness

Readiness requires all of the following for the currently discovered Runtime behavior:

1. a bound model run discovers all thirteen aliases with the canonical schemas and output contracts;
2. real calls exercise A2A, Task create/update/list, bounded Context Retrieval and Memory
   search/read/write/propose behavior through the attested path;
3. mutation calls demonstrate the same Capability, policy, version, quota and idempotency failures as
   the credentialed path;
4. permission removal, ownership divergence, Binding/Epoch change, cancellation and Runtime exit
   revoke subsequent calls;
5. a normal non-Rovai Runtime sees an empty list, receives `run_not_bound` for direct calls, and
   produces no domain writes;
6. exact-injection Runtimes retain their existing thirteen-tool behavior without migration.

Writing configuration, completing MCP initialization or validating only `tools/list` is insufficient.

## Consequences

- Antigravity Members can coordinate Tasks, retrieve bounded Camp context and use authorized Memory
  through the same built-in semantic surface as other supported Agent Runtimes.
- The attested request protocol, permission manager, capability snapshot, Charter compatibility and
  real Smoke matrix become catalog-aware rather than `post_message`-specific.
- Full parity increases the permission rules managed in Antigravity's native configuration, but each
  rule remains exact and the Bridge remains credentialless and useless outside an active proved Run.
- Memory and Task mutations widen the consequences of an Adapter bug, so per-call attestation and the
  existing Core authorization handler are mandatory; Bridge-side authorization is never sufficient.
- Antigravity still preserves uncontrolled ambient MCP and still cannot receive Rovai external MCP
  Assignments. Built-in parity must not be presented as general MCP parity.
- A later built-in tool addition creates a catalog compatibility change and requires equivalent
  evidence on every Runtime claiming complete parity.

## Rejected Alternatives

- **Keep Antigravity permanently on `post_message`.** Rejected because it makes collaboration and
  Memory behavior depend on attachment transport despite a reusable attested Core identity.
- **Expose only the four `team.*` operations.** Rejected because Context Retrieval and Memory are
  part of Rovai's fixed built-in Gateway and the confirmed goal is parity with other Agent Runtimes.
- **Use dotted canonical names in Antigravity.** Rejected because the v0.30 Spike demonstrated a
  native naming compatibility boundary; aliases preserve semantics without repeating that failure.
- **Create separate `rovai-team`, `rovai-context` and `rovai-memory` Servers.** Rejected because it
  multiplies global configuration, permission and ownership surfaces without adding an authority
  boundary.
- **Copy the credentialed Bridge implementation into the attested Bridge.** Rejected because schemas,
  error handling and authorization would drift. Both attachments must share the canonical catalog
  and Core handler.
- **Enable a global permission bypass.** Rejected because one built-in bundle does not justify
  auto-approving unrelated native or ambient tools.
- **Treat tool discovery as a Capability grant.** Rejected because Member business authority and
  current domain visibility remain live Core decisions.

## References

- [v0.31 Default Team Delivery Qualification](../versions/v0.31/README.md)
- [ADR-0014: Stable Team Tool Gateway v2](0014-stable-team-tool-gateway-v2.md)
- [ADR-0051: Boundary-Capped Context Retrieval](0051-boundary-capped-context-retrieval.md)
- [ADR-0068: Brokered Memory Retrieval and Session Entrypoint](0068-brokered-memory-retrieval-and-session-entrypoint.md)
- [ADR-0069: Single Effective Memory and Scope-Bounded Agent Mutation](0069-single-effective-memory-and-scope-bounded-agent-mutation.md)
- [ADR-0088: Attested Native Team Gateway Attachment](0088-attested-native-team-gateway-attachment.md)
