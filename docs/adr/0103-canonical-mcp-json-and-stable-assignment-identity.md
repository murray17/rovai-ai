---
document_type: adr
id: ADR-0103
title: Canonical MCP JSON and Stable Assignment Identity
status: accepted
date: 2026-08-04
decision_scope: cross-version
source_version: v0.37
supersedes: []
superseded_by: null
---

# ADR-0103: Canonical MCP JSON and Stable Assignment Identity

## Context

ADR-0018 established one file-backed MCP Library, but its first implementation exposed a
Rovai-specific tagged Server schema and embedded `enabled` plus `agentProfileIds` into every
connection definition. That representation makes ordinary MCP JSON harder to paste or review,
couples mutable display names to authority, and forces the settings UI to understand separate
Command, Args, URL and Headers forms.

Server names are user-editable object keys. They cannot safely identify Assignments: renaming a
Server must not retarget authority, while deleting and recreating the same name must not inherit old
Assignments. Definitions, enablement and Assignments still need one atomic, inspectable source
without a second SQLite truth.

## Decision

### One canonical JSON envelope

`~/.rovai/mcp.json` is the only source of truth for user-managed external MCP Server definitions,
enablement, immutable identity and Assignments. SQLite contains no MCP Server or Assignment truth.
Production code does not select a legacy brand path.

The public connection surface is the standard top-level `mcpServers` object. Each key is the
canonical MCP Server Name and each value is one strict portable connection definition:

- Stdio requires `command` and may contain `args`, `env` and `cwd`;
- HTTP requires `url` and may contain `headers`;
- `command` and `url` are mutually exclusive and determine transport;
- user definitions cannot contain `serverName`, `transport`, `type`, `enabled`,
  `agentProfileIds`, `missingValues`, `_rovai` or unknown fields.

Rovai-owned state lives in one sibling top-level `_rovai` object with schema version `2`.
`_rovai.servers` is keyed by the same canonical Server Name and records an immutable opaque
`serverId`, `enabled`, provenance and reviewed risk metadata. `_rovai.assignments` contains
relationships from `serverId` to `agentProfileId`. It never uses a mutable Server Name as a foreign
key and never duplicates the name in a `serverName` field.

The same file is validated, normalized and replaced atomically as one unit. Duplicate JSON object
keys, case-insensitive duplicate Server Names, duplicate Server IDs, definition/metadata parity
errors or malformed Assignments invalidate the whole file. Invalid bytes are preserved and are
never replaced by an empty repair.

### Hidden management metadata

The ordinary add/edit surface accepts exactly one standard `mcpServers` entry and never renders or
accepts `_rovai`. The editable object key is the Server Name; rename moves that key while retaining
the existing `serverId`, enablement, Assignments and provenance. No split connection form is
maintained in parallel.

The settings page may show a read-only public configuration preview, but it contains only
`mcpServers`, masks literal sensitive values and is explicitly not the complete source file. The
actual source path may be opened in an external editor.

Raw external editing is an advanced path and must provide a complete valid envelope. Rovai does not
infer identity, repair parity or silently discard malformed fields from raw edits. Read-only loading
preserves Assignments whose AgentProfile is currently unknown as inert data and does not surface an
MCP-page warning. A later successful application-managed mutation prunes those dangling
Assignments.

### Identity and lifecycle

Creating a Server generates a new `serverId` and defaults to disabled and unassigned. Import uses
the same rule. Replacing an existing Server through an explicitly chosen import target preserves
its identity, enablement and Assignments. Editing the connection, transport, secret references or
Server Name also preserves identity.

Deleting a Server atomically removes its definition, metadata and Assignments. Recreating the same
name creates a new identity and never revives old Assignments.

An Assignment and enablement are independent persisted facts. A disabled Server may remain
assigned; it becomes eligible for a future AgentRun only when both facts are true.

### Reviewed built-in definitions

When `~/.rovai/mcp.json` does not exist, Core atomically creates it with reviewed Context7 and
Playwright definitions. Both begin disabled and unassigned. Context7 uses its reviewed remote
endpoint; Playwright uses an exact reviewed package version with isolated browser state and
persistent high-permission risk provenance. GitHub is not a reviewed default.

After creation these are ordinary definitions: users may edit, rename or delete them and they use
the same Assignment and Runtime Projection path as every other Server. Deletion is not automatically
reversed and application upgrades never overwrite an existing instance. Only creation of a new
canonical file materializes the current reviewed defaults.

The first transition that makes a high-permission instance both enabled and assigned requires an
explicit UI acknowledgement recorded in its hidden metadata. This is a product safeguard, not a
Core tool authorization policy or replacement for Runtime-native approval.

### Sensitive values and compatibility

The Renderer receives literal values in `env` and `headers` only through non-persistable,
digest-bound preservation markers. An unchanged marker preserves the exact stored value; replacing
or deleting it changes the canonical file atomically. Markers never enter `mcp.json`, an AgentRun
projection or logs. Environment references remain visible.

There is no production compatibility reader or automatic v1 migration because the application has
not shipped this schema. A developer may migrate, back up or delete local test data outside
production logic.

## Consequences

- Users work with one familiar `mcpServers` JSON shape while Rovai keeps stable authority metadata
  in the same atomic file.
- Rename and delete/recreate behavior can no longer accidentally retarget Assignments.
- Core must enforce duplicate-key detection, parity, case-folded uniqueness, redaction and
  marker-bound secret preservation before every write.
- A fresh configuration is immediately useful for Assignment without silently activating any
  third-party connection.
- Importers normalize into one model and cannot persist temporary missing-value markers or Runtime
  policy fields.
- Raw file editing is powerful but intentionally fail-closed; the UI does not attempt identity
  recovery from ambiguous bytes.

## Rejected Alternatives

- Store Assignments in SQLite: rejected because it creates a second truth and prevents one atomic
  file compare-and-set.
- Use the Server Name as the Assignment key: rejected because the name is mutable and reusable.
- Expose `_rovai` in the JSON editor: rejected because management metadata is not a connection
  definition and would invite accidental identity changes.
- Keep split Command/Args/URL/Headers forms beside JSON: rejected because two editors inevitably
  diverge and obscure the canonical payload.
- Restore built-ins after deletion or overwrite them on upgrade: rejected because a reviewed
  starting point does not justify taking ownership of the user's later configuration.
- Persist import placeholders such as `missingValues`: rejected because transient secret recovery
  state is not a Server Definition.
- Ship a generic legacy migration: rejected because there is no released population to justify a
  permanent compatibility path.

## References

- [v0.37 MCP Configuration and Projection](../versions/v0.37/README.md)
- [ADR-0018: File-Backed MCP Library and Per-Run Runtime Projection](0018-file-backed-mcp-library-runtime-projection.md)
- [ADR-0057: Member Presence and Retained Removal](0057-member-presence-and-retained-removal.md)
