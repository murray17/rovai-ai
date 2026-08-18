---
document_type: adr
id: ADR-0214
title: Crash-Recoverable Windows Skill Projection
status: accepted
date: 2026-08-18
decision_scope: cross-version
source_version: v1.05
supersedes: []
intended_supersedes: []
superseded_by: null
---

# ADR-0214: Crash-Recoverable Windows Skill Projection

## Context

The macOS SkillProjection uses managed links and can replace one entry without copying a mutable directory. Windows MVP
cannot require administrator rights or Developer Mode, so it needs a copy backend. Windows directory moves do not
atomically replace an existing destination; a two-state `staging | ready` journal cannot distinguish crashes before or
after moving the old or new directory. Updating a shared discovery directory while an active Runtime may reread it also
creates a partial-copy exposure that the start-time snapshot cannot describe.

## Decision

Windows uses a copy projection with a private, operation-identified, multi-stage journal. Publishing advances through
`prepared`, `old_moved_to_backup`, `new_promoted`, `verified`, `metadata_committed`, `cleanup_pending`, and `completed`.
Staging, final and backup are siblings on the same admitted volume, and every rename target must not already exist.

Each transition is durable only after copied files and the private journal are flushed, the filesystem operation
succeeds, and the resulting paths are reopened and verified. Recovery never trusts journal state alone: it reconciles
journal operation identity, DB observation and the opened identities/digests of final, staging and backup. A crash
between a rename, DB commit and journal update is handled idempotently; an ambiguous or externally changed state blocks
projection admission and preserves evidence for repair.

An **Execution Root Projection Gate** serializes launch registration with projection replacement on Windows. A launch
holds the shared side while it confirms a ready projection and records the active Run; an update holds the exclusive
side, waits for active Runs in that exact root to settle, and blocks new launches until recovery/publish completes. Core
recovers unfinished journals before opening the root to AgentRun launch. Filesystem work does not run inside a long
SQLite transaction.

Project-owned or externally modified entries are never overwritten or silently deleted. This decision locally replaces
ADR-0161's “active Run never blocks a newer projection update” rule only for the Windows copy backend. macOS link
projection and the remaining Library, root-access, dirty-trigger and start-time evidence boundaries remain unchanged.

## Consequences

- Windows publication is recoverable without claiming nonexistent directory-replace atomicity.
- A Skill update can temporarily wait for an active Windows root; truthful safety is preferred over shared-path
  instability during the copy swap.
- Journal and DB recovery gain explicit operation identity, durability and crash-injection obligations.
- True per-Run Skill isolation remains unavailable because Runtimes still discover one fixed root path.

## Rejected Alternatives

- **Rename staging over an existing final directory.** Windows does not provide the required directory replacement.
- **Use a two-state journal.** It cannot classify the old→backup and staging→final crash windows.
- **Use version directories plus a pointer.** Supported Runtimes do not all discover an indirect path.
- **Require symlink/Junction privileges.** The per-user product must work without administrator or Developer Mode.
- **Allow updates during active Windows Runs.** Copy publication can expose incomplete or changing contents on reread.

## References

- [v1.05 Windows x64 scope](../versions/v1.05/README.md)
- [Windows Skill Projection v1](../contracts/windows-skill-projection-v1.md)
- [Skill Projection Reconciliation](../architecture/skill-projection-reconciliation.md)
- [ADR-0161: Event-Driven Root-Scoped Skill Projection](0161-event-driven-root-scoped-skill-projection-reconciliation.md)
- [Microsoft: Moving Directories](https://learn.microsoft.com/en-us/windows/win32/fileio/moving-directories)
