---
document_type: adr
id: ADR-0153
title: Explicit Empty Self-Active Task Snapshot
status: accepted
date: 2026-08-10
decision_scope: cross-version
source_version: v0.54
supersedes: []
superseded_by: null
---

# ADR-0153: Explicit Empty Self-Active Task Snapshot

## Context

ADR-0152 required every direct or A2A AgentRun to reselect self-active Tasks, but omitted the
`SELF_ACTIVE_TASKS` section whenever the selected set was empty. In a reused Native Session, a prior
Run may have projected active Tasks that are terminal before the next Run. Section absence then fails
to distinguish a current authoritative empty awareness snapshot from a projection that was omitted
because Runtime payload budget could not retain any Task entry.

## Decision

A direct or A2A AgentRun with no self-active Task candidates must render this exact compact snapshot:

```text
[SELF_ACTIVE_TASKS]
{"tasks":[]}
[/SELF_ACTIVE_TASKS]
```

It is a complete current awareness fact for that Run. ContextManifest Evidence records
`included:true`, an empty `selectedTaskRefs` array, no `omittedCount`, and the digest of the exact
`{"tasks":[]}` projection.

Whole-section omission is reserved for a different state: self-active candidates existed, Runtime
payload budget removed every selected entry after optional public history yielded, and at least one
candidate is therefore counted in `omittedCount`. Evidence then records `included:false`, empty
`selectedTaskRefs`, positive `omittedCount`, and no projection digest. Section absence alone never
means that the current self-active set is empty.

Context Delivery Profile v3 remains current because candidate selection, ordering, limit and budget
priority do not change. The model-visible byte change creates AgentRun Context Formatter v13, and the
new inclusion/evidence meaning creates ContextManifest Evidence v11. Migration 71 discards
incompatible technical Context/Delivery evidence and fences non-terminal execution; it preserves
Camp, Task, Message and other business history and retains no v10/v11 or v12/v13 dual reader.

This decision locally replaces only ADR-0152's rule that true empty projections are omitted. All
other Task authority, self-only selection, budget, on-demand read and non-authoritative awareness
boundaries remain in force.

## Consequences

- Completing or losing assignment of an Agent's final active Task produces an explicit clearing
  snapshot on the next Run in the same Native Session.
- Models and diagnostics can distinguish `no current Tasks` from `Task awareness unavailable because
  of payload budget` without a watermark, delta or ACK protocol.
- The small empty section becomes required Dynamic Context; if required content plus this snapshot
  exceeds the Runtime gate, materialization fails rather than silently reclassifying true emptiness
  as budget omission.

## Rejected Alternatives

- Define missing section as empty: Native Session history and payload-budget omission would remain
  ambiguous, and the clearing fact would not be present in model-visible bytes.
- Always emit `{"tasks":[]}` after budget eviction: it would falsely claim a complete empty source set
  when active Tasks existed but were omitted.
- Add a Task freshness watermark or delta ACK: the bounded per-Run full snapshot remains sufficient
  once true emptiness is explicit.

## References

- [ADR-0152](0152-lead-owned-task-responsibility-and-self-active-task-awareness.md)
- [Context Delivery Profile v3](../contracts/context-delivery-profile-v3.md)
- [ContextManifest Evidence v11](../contracts/context-manifest-evidence-v11.md)
- [v0.54 implementation plan](../versions/v0.54/implementation-plan.md)
