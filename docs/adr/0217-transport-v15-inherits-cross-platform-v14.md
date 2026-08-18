---
document_type: adr
id: ADR-0217
title: Built-in Tool Transport v15 Inherits the Cross-Platform v14 Wire
status: accepted
date: 2026-08-18
decision_scope: cross-version
source_version: v1.07
supersedes: []
intended_supersedes: []
superseded_by: null
---

# ADR-0217: Built-in Tool Transport v15 Inherits the Cross-Platform v14 Wire

## Context

Built-in Tool Transport v14 is already accepted and assigns protocol identity to the discriminated
`LocalIpcEndpoint`, IPC protocol v2, Unix Socket and secured Windows Named Pipe. The current implementation remains on
v13. Adding `publicOnly`, canonical `--to-principal`, a revised Send projection and errors needs another contract
identity, but assigning v15 to the old `core_socket` / IPC v1 shape would silently revoke an accepted transport
decision and make the version sequence non-monotonic.

## Decision

Built-in Tool Transport v15 completely inherits v14's local transport wire and security boundary, then adds the v1.07
Camp Send input, CLI, catalog, error and Agent projection changes. Its fixed axes are:

```text
BUILTIN_TOOL_CONTRACT_VERSION = 15
BUILTIN_TOOL_CLI_COMMAND_VERSION = 15
Runtime capability = builtin_cli.transport.v15
fixed command count = 15
IPC protocol = 2
endpoint = LocalIpcEndpoint { unix_socket | windows_named_pipe }
Envelope = 1; receipt = 1; Agent Output = 2
```

The implementation transition is an atomic v13-to-v15 clean break: Core and bundled CLI must implement all v14
endpoint/IPC requirements and all v15 catalog changes before advertising v15. There is no product mode in which v15
uses IPC v1, `core_socket`, an optional dual endpoint or a v14/v15 mixed binding. macOS repeats the complete Unix Socket
v15 matrix; Windows remains subject to per-Adapter Runtime Platform Admission.

ADR-0212 remains the effective reason and security decision for the inherited cross-platform endpoint. This ADR does
not supersede it; v15 is the next transport contract that composes it with the new command surface.

## Consequences

- The implementation scope includes the currently unimplemented v14 endpoint work as a prerequisite, not only the
  A2A command change.
- One capability continues to identify one wire shape across context, catalog digest, health, diagnostics and Runtime
  compatibility.
- A smaller A2A-only release cannot advertise v15 while retaining v13 IPC; it must either complete this scope or defer
  the transport bump and feature release.
- v14 remains useful as the accepted predecessor and design source even if no production build advertises it.

## Rejected Alternatives

- **Use v15 with IPC v1 and `core_socket`.** This silently rolls back ADR-0212 and makes higher version identity mean
  an older incompatible wire.
- **Mutate v14 to add the new Send schema.** v14 is accepted and already identifies another closed contract.
- **Advertise v15 before the endpoint migration is complete.** Runtime capability negotiation would claim security
  and compatibility properties the process does not have.
- **Maintain v13/v14/v15 dual stacks.** Core and CLI ship together, and the additional downgrade surface has no product
  requirement.

## References

- [v1.07 proposal](../versions/v1.07/README.md)
- [Built-in Tool Transport v15](../contracts/builtin-tool-transport-v15.md)
- [ADR-0212: Cross-Platform Local IPC for v14](0212-cross-platform-local-ipc-transport-v14.md)
- [Built-in Tool Transport v14](../contracts/builtin-tool-transport-v14.md)
