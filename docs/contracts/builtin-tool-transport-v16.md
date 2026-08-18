---
document_type: contract
contract: builtin-tool-transport-v16
status: accepted
target_version: v1.10
last_updated: 2026-08-18
---

# Built-in Tool Transport v16

Model-context revision 1 is confirmed. This contract replaces
[Built-in Tool Transport v15](builtin-tool-transport-v15.md) as the current entry. v16 inherits every v15 LocalIpcEndpoint,
IPC v2, Envelope/receipt/replay, process/lease, idempotency, Agent Output v2, fifteen-command catalog, PublicOnly,
Principal attention and progressive help rule. It changes the Camp identity schema used by those operations.

```text
BUILTIN_TOOL_CONTRACT_VERSION = 16
BUILTIN_TOOL_CLI_COMMAND_VERSION = 16
Runtime capability = builtin_cli.transport.v16
fixed command count = 15
IPC protocol = 2; Envelope = 1; receipt = 1; Agent Output = 2
```

## Camp identity delta

Every catalog input/output property named `campId`, and every Camp identity nested in Camp, Task, History or Memory
results, must satisfy [Camp Identity v1](camp-identity-v1.md):

```text
rvcamp_<26 lowercase canonical Crockford Base32 characters carrying RFC UUIDv7>
```

This includes `camp.list/search/read`, `history.search`, Task results and any canonical result that identifies its Camp.
Operations whose Camp is implicit continue to receive it from the authenticated Native Binding/AgentRun; they do not add
a caller-supplied Camp scope. Agent Output projection preserves the same value without decoding or aliasing it.

Catalog input/result Schema, examples, operation description digest, capability, Bootstrap context contract, health,
diagnostics and product fingerprints all move atomically to v16. Camp History contract version is 3, Context Formatter
is 20 and ContextManifest is 18. A v15 catalog/capability, Camp History v2 target or Formatter19/Manifest17 binding is
incompatible before invocation. IPC and command count do not change.

## Native Session separation

Transport authentication continues to bind Runtime process, Native Binding, AgentRun, Camp and Agent identities. The
Camp value authenticates only the recorded Rovai scope; it is never sent to a provider Session/thread resume API.
`nativeSessionId`, `nativeThreadId`, Native Turn and binding fields retain their existing provider/domain formats.

## Clean break and replay

No v15/v16 dual catalog, old Camp UUID alias, downgrade or mixed Binding is accepted. Current v16 receipts replay their
stored canonical results exactly. Pre-v16 local context/binding state is invalidated by Migration 95; business data from
an incompatible pre-release store is quarantined rather than mapped.

## References

- [Built-in Tool Transport v15](builtin-tool-transport-v15.md)
- [Camp Identity v1](camp-identity-v1.md)
- [Camp History Retrieval v3](camp-history-v3.md)
- [ContextManifest Evidence v18](context-manifest-evidence-v18.md)
- [ADR-0219 的迁移后决定正文](../versions/v1.10/decisions.md#adr-0219)
