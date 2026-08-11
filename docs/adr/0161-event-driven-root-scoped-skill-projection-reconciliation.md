---
document_type: adr
id: ADR-0161
title: Event-Driven Root-Scoped Skill Projection Reconciliation
status: accepted
date: 2026-08-11
decision_scope: cross-version
source_version: v0.58
supersedes: []
superseded_by: null
---

# ADR-0161: Event-Driven Root-Scoped Skill Projection Reconciliation

## Context

SkillProjection is a rebuildable view of the application-global Skill Library inside Runtime-native
project directories. Treating every historical observation as a permanent reconciliation target made
application startup and a fixed 30-second loop revisit old Camp directories without a current user or
AgentRun need. On macOS that behavior could repeatedly request protected-folder access even after the
Project had been removed from the sidebar.

ADR-0105 protected an active Run by retaining its old Revision projection and allowed a newer Run to
record stale exposure instead of waiting. That rule does not match the available filesystem model:
different Agents can share one execution root and Runtime discovery path, while no supported Runtime
provides a per-session Skill directory. Artificial drain, generation, or Revision leases would add a
second scheduler without delivering genuine isolation.

## Decision

Rovai-ai keeps three separate authorities:

1. Skill Library is the application-global desired state.
2. SkillProjection is a mutable, rebuildable view in one execution root.
3. SkillExposureSnapshot is immutable evidence of what one AgentRun preflight observed at start.

Skill installation, Revision update, enablement, Group Assignment, deletion, Runtime selection, and
bundled-content repair update authoritative state and mark affected known projections dirty in SQLite.
They do not enumerate, canonicalize, watch, or reconcile historical execution roots. Application
startup restores the Library, AgentRun recovery data, projection observations, dirty/pending cleanup,
and Project-removal access state without reading those project directories. There is no periodic
filesystem reconciliation loop.

Every new AgentRun performs mandatory root-scoped preflight. Core first rejects a removed execution
root without resolving it, then canonicalizes only the current root, derives the selected Runtime's
Delivery Groups plus Groups required by other active Runs in that exact root, reconciles to the latest
Library state, verifies the resulting managed entries, and records SkillExposureSnapshot before the
Runtime starts. Missing or stale Rovai-managed entries are repaired; an unverified `error` or `stale`
entry blocks launch. Project-owned entries remain untouched and may be recorded as `shadowed` because
safe non-overwrite is stronger than forced Rovai delivery.

An active AgentRun does not lease a Revision or block another Agent's newer Run. A later preflight may
update or remove shared projection entries while the older Run continues. If the older Runtime reads
the shared directory again, it may see the newer contents or absence. SkillExposureSnapshot therefore
records start-time exposure evidence only; it is neither lifetime filesystem isolation nor proof that
the Runtime loaded a Skill. Same-Agent serialization remains an AgentRun invariant independent of
Skill projection.

Skill Projection Observation is ownership and evidence, never an access grant or scheduling source.
Stored diagnostics read SQLite facts only; a filesystem audit or broad repair requires an explicit
user action and excludes roots marked removed.

Removing a directory Project from the local sidebar mirrors `removed` Skill Projection Root Access
into Core. With no active Run, that explicit action may perform one best-effort managed-link cleanup;
with an active Run, cleanup waits only for that Run's terminal hook. Afterward Rovai-ai performs no
startup scan, periodic reconciliation, watcher creation, observation-driven access, or new Run
preflight for the removed root. Restoring or reselecting the directory marks it active and dirty so
the next Run preflight repairs it. Crash recovery may touch only roots required by genuinely active
executions.

This decision locally replaces ADR-0105's active-Run Revision retention and stale-new-Run clauses. Its
Library identity, Delivery Group, overlap, safe non-overwrite, and Runtime-native ownership rules remain
in force. ADR-0158's default-all Assignment rule also remains unchanged.

## Consequences

- App launch, passive diagnostics, and elapsed time no longer justify filesystem access to historical
  Project directories.
- A new Run sees the latest verified Library state without waiting for unrelated Agents to drain.
- Existing Runs continue without forced cancellation, but shared projection contents are intentionally
  not stable for their entire lifetime.
- Removed Project access is explicit and durable while Camp and AgentRun history remain intact.
- Dirty and pending cleanup state can survive restart without pretending to be live directory health.
- True Revision isolation remains unavailable until a Runtime offers a native per-session or per-Run
  Skill directory.

## Rejected Alternatives

- Scan every known or observed root at startup: rejected because historical evidence is not current
  access intent and protected folders may prompt without user action.
- Reconcile every root on a fixed interval or maintain watchers: rejected because freshness is needed
  at AgentRun admission, not continuously for Settings presentation.
- Drain active Runs, queue new Runs, or maintain projection generations: rejected because shared native
  discovery paths cannot provide the isolation that this machinery would claim.
- Copy every Skill Revision into a private per-Run tree: rejected because current Runtimes do not discover
  that tree and adapter-specific emulation would create inconsistent semantics.
- Treat `SkillExposureSnapshot` as a lifetime file lock: rejected because it is durable evidence, not a
  filesystem ownership protocol.

## References

- [v0.58 overview](../versions/v0.58/README.md)
- [ADR-0105: Runtime-Group Assigned Rovai Skill Delivery](0105-runtime-group-assigned-skill-delivery.md)
- [ADR-0158: Default-All Runtime Delivery for Managed Skills](0158-default-all-runtime-delivery-for-managed-skills.md)
- [Skill Projection Reconciliation architecture](../architecture/skill-projection-reconciliation.md)
- [Domain terminology](../../CONTEXT.md)
- `crates/rovai-core/src/skill_projection.rs`
- Migration 75 in `crates/rovai-core/src/db.rs`
