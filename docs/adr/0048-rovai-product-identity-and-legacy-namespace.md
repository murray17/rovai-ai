---
document_type: adr
id: ADR-0048
title: "Rovai-ai Product Identity and Controlled Legacy Namespace Migration"
status: accepted
date: 2026-07-26
decision_scope: cross-version
source_version: v0.11
supersedes: []
superseded_by: null
---

# ADR-0048: Rovai-ai Product Identity and Controlled Legacy Namespace Migration

## Context

The project has used Lumen AI and, during an unpublished rename, Horizonward naming. Public
identity, desktop packaging, private packages, Core binaries, runtime namespaces and configuration
paths must converge on one exact brand without changing the Camp-centered domain model, permission
boundaries, audit semantics or supported third-party Runtime names.

Some old names are also locations or values that existing installations may still contain. A
controlled rename must emit only the new namespace while continuing to discover prior local state
long enough to avoid presenting an empty application after upgrade.

## Decision

The formal product name is **Rovai-ai**. The GitHub repository and root package slug are
`rovai-ai`. Ordinary internal identifiers use `rovai`; the Rust package, crate and executable use
`rovai-core` / `rovai_core`.

The desktop identity is:

- Electron `productName`: `Rovai-ai`;
- Electron `appId`: `ai.rovai.desktop`;
- Renderer API: `window.rovai`, typed as `RovaiApi`;
- IPC namespace: `rovai:*`;
- Core override: `ROVAI_CORE_BIN`;
- logs: `[rovai-core]`;
- diagnostics filename prefix: `rovai-diagnostics-`;
- macOS artifact prefix: `Rovai-ai-`.

New application-owned state uses `Rovai-ai` Electron `userData`, `~/.rovai`, `rovai.sqlite`,
`refs/rovai/camps/*`, `rovai_team`, `rovaiTeamTool` / `rovaiTeamReceipt`,
`rovai.team-tool-*.v1`, `rovai-diagnostics-v4`, `rovai-memory-export-v1`,
`rovai://bundled` and Rovai-managed Git exclude markers.

Compatibility is read/select/migrate-in-place, never merge or dual-write:

- explicit `--user-data-dir` wins;
- otherwise an existing Rovai-ai location wins, followed by Horizonward, Horizonward AI and
  Lumen AI locations;
- `~/.rovai/<resource>` wins, followed by `~/.horizonward/<resource>` and
  `~/.lumen/<resource>`;
- within the selected data directory, `rovai.sqlite` wins; `lumen.sqlite` is reused only when the
  preferred database is absent;
- `ROVAI_*` environment variables win; corresponding `HORIZONWARD_*` and `LUMEN_*` variables are
  accepted only as fallback inputs;
- old managed Git exclude blocks and the MCP initial-scan key are recognized and rewritten under
  the Rovai namespace.

Existing database rows may still contain historical source URIs or Git reference namespaces.
Those stored values remain valid object identifiers; newly created values use `rovai`. Core and
its bundled bridges change their transient Team MCP field names atomically, without changing tool
purposes, authorization checks, schemas beyond namespace keys, or domain behavior.

Lumen AI and Horizonward names may remain only in historical documents, migration tests and
explicit compatibility inputs. Third-party names including OpenAI, Antigravity, Claude, Codex,
OpenCode, Copilot and MCP are never rewritten as part of product branding.

The rename does not replace the application icon and does not authorize Renderer layout,
component, theme, color, spacing or interaction changes. Only exact brand text may change in UI
surfaces.

## Consequences

- New source, build output and runtime-generated identifiers consistently use Rovai-ai / Rovai.
- Existing local state remains discoverable without copying, merging or destructive migration.
- Changing `appId` establishes a new desktop bundle identity as explicitly required; userData
  compatibility selection prevents this from silently hiding existing application data.
- Old environment names and filesystem names are compatibility inputs, not approved names for new
  output.
- Removing a legacy input later requires a separate migration decision and upgrade evidence.

## Rejected Alternatives

- Keep Lumen AI or Horizonward as a secondary public name: leaves multiple active identities.
- Use alternative capitalization or separators for the brand: violates the single naming contract.
- Rename third-party products containing “AI”: corrupts upstream product and protocol names.
- Delete or eagerly copy old local state: creates avoidable data-loss and conflict risks.
- Combine the rename with visual redesign: broadens scope and makes functional regression harder
  to isolate.

## References

- [v0.11 Rovai-ai 产品更名](../versions/v0.11/README.md)
- [UI 规范](../ui/README.md)
- [ADR-0014: Stable Team Tool Gateway v2](0014-stable-team-tool-gateway-v2.md)
- [ADR-0017: Managed Skill Library and Runtime-Native Projection](0017-managed-skill-library-runtime-projection.md)
- [ADR-0018: File-Backed MCP Library and Per-Run Runtime Projection](0018-file-backed-mcp-library-runtime-projection.md)
