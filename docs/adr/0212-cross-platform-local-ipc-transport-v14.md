---
document_type: adr
id: ADR-0212
title: Cross-Platform Local IPC for Built-in Tool Transport v14
status: accepted
date: 2026-08-18
decision_scope: cross-version
source_version: v1.05
supersedes: []
intended_supersedes: []
superseded_by: null
---

# ADR-0212: Cross-Platform Local IPC for Built-in Tool Transport v14

## Context

Built-in Tool Transport v13 freezes Unix IPC, protocol version 1 and the `builtin_cli.transport.v13` capability. Reusing
that identity for a discriminated endpoint and Windows Named Pipe would make equal compatibility identifiers describe
different context bytes and connection behavior. Maintaining two optional endpoint fields would also force clients to
guess precedence.

## Decision

Rovai adopts Built-in Tool Transport v14 as a clean break. v14 keeps the fifteen canonical operations, CLI commands,
Envelope, receipt/replay, lease, idempotency and Agent Output semantics of v13, while replacing `core_socket` with one
required discriminated `LocalIpcEndpoint` supporting Unix Socket or Windows Named Pipe.

The contract, CLI command and Runtime capability versions become 14; local IPC protocol becomes 2. A v13 Context fails
closed under a v14 CLI and Core. Core and the bundled CLI are shipped and drained together, so the first v14 release has
no v13/v14 dual stack.

Windows uses a byte-mode Named Pipe with the existing newline-delimited JSON framing. Pipe security is applied at first
creation through `SECURITY_ATTRIBUTES`, remote clients are rejected, the first instance reserves the random per-Core
name, and every later instance receives the same protected DACL. OS access control does not replace process/lease tokens.

macOS also moves to v14 and must repeat the complete current Runtime transport regression; Windows eligibility remains
per-Adapter through Runtime Platform Admission. This locally refines ADR-0124's former all-Runtime global release gate:
every Runtime qualified on a shipped platform must pass v14, while an unqualified Windows Adapter stays unselectable
rather than forcing a false global support claim.

## Consequences

- Endpoint evolution is explicit in capability, context, digest, health and compatibility identities.
- Platform transport varies behind one local-IPC seam; Router and domain operations remain transport-independent.
- The macOS Unix backend cannot be assumed unchanged merely because v14 primarily enables Windows.
- An App update must drain old Runtime processes before starting the v14-only Core/CLI bundle.

## Rejected Alternatives

- **Keep v13 and only increment IPC protocol.** The frozen v13 context and capability would become ambiguous.
- **Keep `core_socket` plus an optional pipe field.** Two sources create precedence and downgrade ambiguity.
- **Run v13 and v14 indefinitely.** Bundled same-version delivery does not justify a permanent dual protocol.
- **Use localhost TCP on Windows.** It expands firewall, port allocation and listener exposure semantics.

## References

- [v1.05 Windows x64 scope](../versions/v1.05/README.md)
- [Built-in Tool Transport v14](../contracts/builtin-tool-transport-v14.md)
- [ADR-0124: CLI-Only Built-in Operations](0124-cli-only-transport-for-rovai-built-in-operations.md)
- [Built-in Tool Runtime](../architecture/builtin-tool-runtime.md)
