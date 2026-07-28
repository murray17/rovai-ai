---
document_type: adr
id: ADR-0059
title: "Runtime-Owned Resource Permissions and Path-Only Run Workspace"
status: accepted
date: 2026-07-28
decision_scope: cross-version
source_version: v0.16
supersedes: [ADR-0015]
superseded_by: null
---

# ADR-0059: Runtime-Owned Resource Permissions and Path-Only Run Workspace

## Context

ADR-0015 made Rovai-ai Core a second resource-authorization layer above every native Agent
Runtime. Core froze `executionRoot`, `read_only | write` and an Action Permission Envelope,
then evaluated Shell, filesystem, Git, network and Runtime permission requests against those
generic rules.

That model conflicts with the actual multi-Runtime boundary:

- each Adapter already exposes its Runtime's native permission configuration;
- native Runtimes differ in sandbox, approval option, session lifetime and dynamic permission
  semantics;
- an A2A target Run currently receives the sender's complete `workspace_json`, so a sender's
  Core-level `read_only` value can override the recipient Agent's own Runtime configuration;
- Core may reject a Runtime request for another directory before the user can see and decide the
  native request;
- a generic Core policy cannot faithfully represent every supported Runtime without becoming a
  second, drifting sandbox.

Rovai-ai must continue to show real Runtime permission requests, persist user decisions, fence
stale callbacks and protect files owned by Rovai-ai itself. Those responsibilities do not require
Core to authorize an Agent's resource access.

This ADR replaces ADR-0015 in full. It preserves durable recording and recovery only for effects
and permission requests that Core actually mediates or the Runtime actually reports; it removes
the claim that every Agent resource operation must first pass a Core Action policy.

## Decision

### Resource authority belongs to the recipient Runtime

For every new AgentRun, filesystem, Shell, Git, network and Runtime-tool resource permissions are
owned by:

```text
recipient AgentProfile
→ recipient Adapter Permission Configuration
→ frozen recipient Run Runtime Configuration
→ native Runtime
```

Core must not:

- inherit the sender Run's permission configuration;
- intersect sender and recipient resource capabilities;
- derive resource authority from Run Workspace;
- reject an Agent operation because its target is outside `executionRoot`;
- reject a write because a legacy Workspace field says `read_only`;
- decide that an Approval cannot increase a Runtime's native resource scope;
- create a generic allow/ask/deny policy for Agent filesystem, Shell, Git or network operations.

The recipient's Adapter, model and Adapter Permission Configuration are resolved from the
recipient AgentProfile and frozen when the target AgentRun is created. Later profile changes
affect only later Runs. Native session-scoped decisions retain their upstream Runtime meaning and
remain owned by that Runtime.

This boundary does not remove Core business authorization. Member Presence, Camp membership,
Team Tool capabilities, Task mutation capabilities, Runtime Readiness, A2A depth and quotas,
Native Binding identity, execution epochs, idempotency and command fencing remain Core-enforced.

### Permission semantics are versioned per Run

AgentRun freezes one internal permission interpretation:

```text
core_enforced_v1
runtime_managed_v2
```

Every Run created after the v0.16 migration uses `runtime_managed_v2`. Only Runs that were
non-terminal at upgrade retain `core_enforced_v1`, so an unfinished legacy Run can recover under
the semantics with which it began. Pre-upgrade terminal Runs never re-enter execution; their
historical Action/Approval/Workspace records retain their original facts without requiring an
active v1 execution path.

This is a compatibility discriminator, not a user-selectable product mode. The product does not
offer a permanent `RuntimeManaged | CoreEnforced` preference. After no recoverable v1 Run remains,
a later migration may delete v1 behavior and obsolete fields.

Physical fields including `execution_root`, `access` and `workspace_json` may remain during the
compatibility period. Under `runtime_managed_v2`, `access` and any legacy Action Permission
Envelope have no resource-authorization effect.

### Run Workspace is a working-directory snapshot

The logical Run Workspace is:

```rust
struct Workspace {
    path: PathBuf,
}
```

It is the immutable absolute, existing directory used to start and recover one AgentRun. Core may
verify that it is usable as a process working directory before launch. It is not a sandbox root,
allowlist, repository ownership claim or permission grant.

An Agent may use its Runtime to access or switch to another directory. Core does not compare that
operation with the frozen Workspace path.

### A2A does not gain a Workspace argument

`team.post_message` keeps its existing model-controlled schema: recipient, body, generic
references and optional reply linkage. It gains no `workspacePath`, `taskId`, `parentRunId`,
permission or capability argument.

When Core creates an A2A target Run:

- the startup/recovery working-directory path is copied deterministically from the source Run;
- no sender Workspace access value or sender Runtime permission configuration is copied;
- the target uses the recipient's newly frozen Run Runtime Configuration;
- the target does not inherit the source Run's optional Task association;
- parent Run, root Run and A2A depth are derived from the authenticated source binding;
- target context is assembled under the existing reproducible-context rules rather than copying
  the sender's complete prompt or private Conversation.

If the recipient should work in another directory, the sending Agent expresses that requirement
as ordinary message content or durable Task description. The recipient interprets it and changes
or targets directories through its own Runtime. Core does not parse that prose into authority or
Run metadata.

### Native permission requests remain user-visible

When a Runtime with structured dynamic approval support emits a permission request, Rovai-ai:

1. validates only the current Binding, Run, epoch, native request identity and round-trip shape;
2. durably records the exact native request, stable digest and native decision options;
3. shows the request and those options to the target user;
4. records the user's selected native option;
5. delivers the exact corresponding result to the same fenced Runtime request;
6. records delivery acknowledgement or an honest recovery/failure state.

Core does not re-evaluate the requested path or operation against Workspace or a generic resource
policy. A Runtime permission request from an otherwise valid current Run is not suppressed by the
legacy `action.request` Capability.

The UI may localize labels and explain consequences, but it must preserve the native option ID,
scope and lifetime. A one-off decision never silently edits the AgentProfile's Adapter Permission
Configuration. A session decision remains scoped exactly as the Runtime defines it.

If an Adapter cannot round-trip a request or its choices without guessing, it fails closed with an
explicit Runtime/Adapter diagnostic. It must not auto-approve, invent an Approval, map to a wider
option or reinstate Core resource authorization. Runtimes without structured dynamic approval run
with their frozen Adapter configuration and expose the missing capability honestly.

### Runtime action recording is observationally honest

Core creates a Runtime Action Record only when:

- a native Runtime permission request was actually received;
- a Runtime reported an action or result;
- or Core itself mediated a separately authorized application/domain operation.

Core does not synthesize ActionExecutions or Approvals for operations that the Runtime neither
requested nor reported. Absence of a Runtime Action Record is therefore not proof that no resource
operation occurred.

For recorded requests and effects, stable identity, request/result digests, epoch fencing,
delivery checkpoints and `unknown` outcome semantics remain. Unknown-effect reconciliation applies
only to a genuinely tracked dispatch or reported effect; it cannot manufacture knowledge about an
unreported Runtime operation.

### Rovai-ai-owned file safety remains Core-enforced

This decision does not weaken file safety for resources managed by Rovai-ai itself. Core continues
to enforce path, traversal, symlink, ownership, permission, size and atomic-write rules for:

- avatar and managed blob assets;
- Skill, MCP and Memory projections;
- private Runtime configuration and credentials;
- local sockets, logs and temporary files;
- database, migration and application-owned export/import paths.

These checks protect application integrity. They do not authorize or restrict the Agent Runtime's
general filesystem access.

## Consequences

- A2A execution can no longer become accidentally read-only because its sender was read-only.
- Each Agent behaves according to its own upstream Runtime configuration, including native
  approval lifetime and sandbox semantics.
- The user still sees real directory, command and other structured Runtime permission requests in
  Rovai-ai and can choose among the native options.
- Core no longer claims complete knowledge or prior authorization of every Agent resource effect.
- Action/Approval persistence becomes a faithful relay and audit mechanism rather than a second
  cross-Runtime policy engine.
- Legacy Run recovery requires a temporary dual implementation path and an explicit migration
  discriminator.
- Retained Workspace and Action-policy fields may look authoritative unless read models,
  diagnostics and tests clearly label or hide their legacy-only meaning.
- Adapter contract and real-Runtime tests become more important because permission correctness now
  depends on lossless upstream configuration and request/result translation.

## Rejected Alternatives

- Continue copying complete `workspace_json` over A2A: rejected because it transfers sender
  permission semantics into an independently configured recipient.
- Add `workspacePath` to `team.post_message`: rejected because working-directory changes can be
  expressed in task semantics and do not belong in the model-controlled Team Tool contract.
- Store Workspace on Task: rejected because Task responsibility is durable collaboration state,
  while working directory is a per-Run launch concern.
- Let the LLM provide `parentRunId` or a complete context blob: rejected because lineage and
  reproducible context are Core-derived trusted state.
- Keep a generic Core `read_only | write` sandbox above every Runtime: rejected because it
  duplicates and distorts Adapter-native permissions.
- Hide native Runtime requests because Core no longer authorizes them: rejected because user
  visibility and decision relay are still required.
- Synthesize an Approval for a Runtime without structured approval support: rejected because Core
  cannot safely pause or resume a protocol interaction that never occurred.
- Make `RuntimeManaged | CoreEnforced` a permanent user preference: rejected because it would
  preserve two competing authorization products indefinitely.
- Delete every legacy Workspace and Action field immediately: rejected because unfinished Runs and
  existing databases require recoverable migration.

## References

- [v0.16 Runtime 权限归属与 Workspace 语义收敛](../versions/v0.16/README.md)
- [ADR-0014: Stable Team Tool Gateway v2](0014-stable-team-tool-gateway-v2.md)
- [Superseded ADR-0015: Action and Safety v2](0015-action-safety-v2.md)
- [ADR-0016: Multi-Runtime Execution Boundary v2](0016-multi-runtime-execution-v2.md)
- [ADR-0049: Reproducible Context Delivery v2](0049-reproducible-context-delivery-v2.md)
