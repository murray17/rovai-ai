---
document_type: adr
id: ADR-0042
title: "Fail-Closed Memory Projection"
status: accepted
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: null
---

# ADR-0042: Fail-Closed Memory Projection

## Context

Memory Projection is a live, disposable read view rather than an immutable Run snapshot. After a
Memory is revised, retired, superseded or forgotten, a previously correct file can become stale.
If projector then fails, keeping the last-good file as an availability fallback can expose content
that SQLite no longer considers active or readable. This is especially harmful after Forget.

Deleting the path silently gives Runtime Agents no way to distinguish “no Memory” from a broken
projection. A small explicit unavailable file provides a clearer fail-closed result while keeping
the stable Guide path useful for recovery.

## Decision

When projector knows an exposed Memory Projection is stale, corrupt, oversized or cannot be
rendered from authoritative SQLite, it must not intentionally continue presenting last-good
content as current.

It attempts to atomically publish a deterministic, body-free `UNAVAILABLE` Markdown sentinel at
the affected projection location. The sentinel:

- states that long-term Memory at this location is temporarily unavailable;
- tells the Agent not to rely on the Scope;
- may include a stable non-sensitive diagnostic code;
- contains no Memory body, Proposal candidate, previous entry list or source content.

Stable reconciliation continues retrying. When current projection rendering succeeds, projector
atomically replaces the sentinel with the deterministic current file without changing SQLite or
the frozen Memory Guide.

For Relationship directories, physical sentinel naming and directory-swap mechanics are version
protocol details, but known-stale children cannot be deliberately retained as fallback.

If the filesystem prevents both sentinel replacement and stale-file removal, Lumen records a
high-priority user-visible diagnostic and keeps retrying. It cannot guarantee that physical bytes
have disappeared during a total filesystem failure, but it must not mark the old digest current
or report projection health as successful.

Authoritative SQLite commands never roll back because projection or sentinel publication fails,
consistent with ADR-0001 and ADR-0053.

## Consequences

- Agents do not intentionally receive retired or forgotten last-good Memory as current context.
- A stable path can communicate unavailability and recover without a new AgentRun.
- Projection health must distinguish valid-empty, unavailable and stale-write-failed states.
- Projector needs atomic file replacement plus stable retry and high-priority diagnostics.
- Total filesystem failure remains an explicit physical limitation rather than a claimed erasure
  guarantee.
- Tests must inject render, size, rename, permission and disk failures around lifecycle changes.

## Rejected Alternatives

- Serving last-good indefinitely: prioritizes availability over current Memory governance.
- Publishing a truncated or partial file: makes omissions invisible and breaks deterministic
  projection.
- Treating a missing file as an empty Memory set: hides failure from the Agent.
- Rolling back SQLite: violates the authoritative transaction boundary and couples Core to file
  I/O.
- Claiming physical deletion under any filesystem failure: cannot be guaranteed by the
  application.

## References

- [v0.10 长期记忆](../versions/v0.10/README.md)
- [ADR-0001: Core Transaction](0001-core-transaction.md)
- [ADR-0027: Memory-Domain Forgetting](0027-memory-domain-forgetting.md)
- [ADR-0053: User-Preauthorized Provisional Companion Lessons](0053-user-preauthorized-provisional-companion-lessons.md)
