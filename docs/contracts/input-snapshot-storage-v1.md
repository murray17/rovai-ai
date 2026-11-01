---
document_type: protocol-contract
contract: input-snapshot-storage-v1
authority: context-snapshot-storage-and-current-database-admission
status: accepted
version: 1
last_updated: 2026-10-31
---

# Input snapshot storage and database admission

This contract supersedes the duplicate-proof storage and recovery requirements inherited by
[ContextManifest v33](context-manifest-evidence-v33.md). It introduces no model format or
runtime snapshot-version axis. Public 33/10/9 and non-batch 28/7/6 serialization, selection,
section order, input sizing and actual model-visible bytes remain unchanged.

## Input storage

Keep the final Dynamic Context Blob, separately delivered Bootstrap material, Run/Binding
association, source IDs, history boundaries, omission metadata and material actually used to
recover Skills, MCP and attachments. New manifests do not duplicate Profile JSON, Run Facts
text, Self Active Task/A2A proof objects or Additional Skills text. Their legacy columns are
nullable; historical rows are preserved and the read model exposes absent legacy values as NULL.
The final input continues containing these sections and can be recovered without rerendering.

New manifests omit per-message projected-body/input hashes and the independent profile, shared-message, Run Facts, attachment-reference,
Skill exposure/resolution, MCP exposure/projection, Self Active Task, A2A and rendered-payload
proof digests. Already frozen inputs do not need their generation-version combinations or
intermediate copies revalidated. Necessary JSON parsing, source/binding checks and payload
limits remain. Unmaterialized historical RunInput still uses its original serializer.

Preparing an already materialized Run, including after reopening the database or advancing its
execution epoch, recovers MCP from the retained exposure JSON and private configuration file.
It does not read or validate the retired MCP digest columns. Existing file permissions,
Run/adapter identity and native-name conflict handling remain; the file identity used for
Runtime process reuse is independent of these retired manifest fields. Run diagnostics expose
missing legacy digests as NULL rather than requiring a non-null string.

Managed Blob content addressing remains its existing storage responsibility; Context reuses
that identity for Runtime delivery correlation. Charter, collaboration and workspace change
markers still determine whether those materials are sent. Accepted/unknown inputs are not
replayed by this change. Native Session recovery remains governed by CLI kind under
[Runtime Launch v60](runtime-launch-and-verification-v60.md).

## MCP snapshot storage layout

New Runs record `mcpSnapshotLayout: "run_v1"` in their existing `effective_config_json`, in
the Run creation transaction through the shared effective-config builder. It participates in
the existing config digest, without changing the private MCP JSON format or its byte digest.
This internal storage marker is not a model-input, native configuration or Host compatibility field.
Runtime rebinding and recovery retain the original marker, including its absence.

Marked Runs publish exactly one `runtime/mcp/<run-id>/snapshot/canonical.json`. Preparation,
redispatch and interruption recovery reuse that file without scanning legacy epoch directories.
Missing markers retain `runtime/mcp/<run-id>/<epoch>/canonical.json` and the existing epoch-copy
recovery logic, including Runs queued before upgrade. No existing Run is backfilled, migrated,
merged or newly retired. An unknown or malformed marker rejects only that Run's preparation;
it does not participate in database admission or subsystem initialization.

Publication retains private hidden staging directories and atomic directory commit. Directory
presence alone is not success: the canonical file must pass the existing permission, identity,
content and frozen-exposure checks. A concurrent loser may reuse only a validated winner;
neither later global configuration nor a failed publisher overwrites it. Missing frozen material
keeps the existing error and legacy-empty exception, without refreezing current global settings.

Existing MCP root, Run and snapshot/epoch directories are used according to actual filesystem
access. A usable Unix `0755` directory or an inherited/broader Windows directory DACL does not
reject preparation, publication or reuse, including tasks with no external MCP servers. These
operations do not repair existing directory permissions or require WRITE_DAC. New directories
and canonical files retain creation-time private permissions; canonical-file permission checks,
directory type/reparse checks and Windows native path/volume/identity checks remain. Genuine
read, write or atomic commit failures propagate without replacing the retained snapshot.

Bounded background maintenance removes a Run root only when an existing terminal Run and its actual cleanup acknowledgment prove that it is no longer used. Unknown, orphaned, unacknowledged and interrupted hidden directories are retained. Enumeration and deletion run outside the database lock; a short lock rechecks the receipt and renames the exact root to a unique discard path. Each loop consumes the shared entry/time budget.

Grok newly generated plugins retain the `grok-mcp-plugin-v2-` prefix. Adapter initialization does not sweep historical MCP files, plugin directories or Claude input files. Old prefixes and unknown ownership are retained, and cleanup failure never changes Runtime availability. Host-held `EphemeralMcpConfigFile` retains exact-file release cleanup and lives through Host reuse.

An unreadable or invalid global MCP file is projected through the existing `configStatus: invalid` and warning codes for new unfrozen Runs. Ordinary tasks may execute with those related tools unavailable. This never rewrites a frozen snapshot to empty configuration or marks a failed load ready. Built-in tools retain their independent checks. The original configuration is preserved, including failed legacy migrations.

## Database opening and upgrade

Migration 196 moves schema 145 to 146 transactionally. It relaxes the retired columns, retains
all existing rows and Blob references, and retires the Usage status-update trigger. Current
opening checks the contract/schema/classifier marker, the current migration completion record,
required operational columns and command identity index. It does not compare CREATE SQL text
or require every historical migration receipt. Historical source recognition stays inside the
supported upgrade chain; missing required structures and future schemas are still rejected.

Usage and notification projections are excluded from whole-database admission; their diagnostics
belong to those modules. Finalizing summary rows uses the existing Usage worker, so absent or invalid
statistics structures cannot roll back a business Run status transition. No startup replacement
of the database, data deletion, additional reconciliation worker or automatic repair is added.

The old binary does not support schema 146. Keep matching Core/CLI versions when deploying;
this migration is not a promise that old writers accept the new nullable fields.
