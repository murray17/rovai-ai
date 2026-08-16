---
document_type: adr
id: ADR-0197
title: Empty User-Owned MCP Library Without Product Presets
status: accepted
date: 2026-08-16
decision_scope: cross-version
source_version: v0.91
supersedes: []
superseded_by: null
---

# ADR-0197: Empty User-Owned MCP Library Without Product Presets

## Context

ADR-0103 added disabled Context7 and Playwright definitions whenever Rovai-ai created a canonical
MCP configuration. Even when disabled, those definitions make a third-party trust choice on the
user's behalf, give product-owned presets a distinct provenance lifecycle, and make an empty Library
impossible to distinguish from an untouched installation.

The MCP Library already supports manual creation, confirmed local import, stable Assignment and
per-Run Runtime Projection without any preset dependency. Rovai-ai has not shipped publicly, so the
remaining pre-release configuration population does not justify a permanent compatibility surface.

## Decision

A newly created MCP Configuration File contains empty `mcpServers`, empty management metadata and no
Assignments. Rovai-ai does not bundle, materialize, restore or advertise any third-party MCP Server
definition. Every persisted Server originates from an explicit user creation or a user-confirmed
import.

This decision locally replaces ADR-0103's reviewed built-in definitions and preset provenance. The
canonical schema v2 envelope, stable Server identity, enablement, Assignment, risk acknowledgement,
sensitive-value preservation, import and Runtime Projection boundaries remain unchanged.

The release that removes presets may clean pre-release configuration by deleting metadata entries
whose source is explicitly `builtin` and Assignments that reference their Server IDs. It must not
delete by Server Name. Configuration that cannot enter the current strict schema may be reset rather
than creating a permanent compatibility reader; SQLite AgentRun exposure, Evidence and audit history
are outside this file migration.

## Consequences

- First use presents an empty Library with manual-add and local-import entry points.
- User-created or imported Servers named Context7, Playwright or any former preset name remain
  ordinary user-owned definitions.
- Product code, contracts and UI no longer need preset identity, package pins or a built-in source
  presentation.
- Development data that cannot satisfy the current strict schema may be discarded during the
  pre-release clean break.

## Rejected Alternatives

- Keep disabled presets as examples: rejected because presence still represents a product-owned
  third-party choice and prevents a truthful empty state.
- Remove only known preset names: rejected because names are user-editable and cannot identify
  provenance safely.
- Retain preset compatibility fields indefinitely: rejected because the product has not shipped and
  no durable external population requires that surface.

## References

- [v0.91 Empty MCP Library](../versions/v0.91/README.md)
- [ADR-0018: File-Backed MCP Library and Per-Run Runtime Projection](0018-file-backed-mcp-library-runtime-projection.md)
- [ADR-0103: Canonical MCP JSON and Stable Assignment Identity](0103-canonical-mcp-json-and-stable-assignment-identity.md)
- [ADR-0125: Runtime-Native Additive External MCP Projection](0125-runtime-native-additive-external-mcp-projection.md)
