---
document_type: version-contract
version: v0.41
authority: runtime-activity-contract
status: accepted
last_updated: 2026-08-05
---

# v0.41 Canonical Runtime Activity Contract

## Wire shape

```ts
type CanonicalRuntimeActivity = {
  operationId: string
  classifierVersion: 'activity-v1'
  activityDomain: 'shell' | 'file' | 'git' | 'network' | 'tool' |
    'permission' | 'runtime' | 'plan' | 'unknown'
  semanticKind?: string
  toolName?: string
  presentationHint?: string
  phase: 'started' | 'progress' | 'terminal'
  outcome: 'succeeded' | 'failed' | 'denied' | 'cancelled' |
    'not_executed' | 'unsettled' | 'unknown'
  credibility: 'core_verified' | 'runtime_structured' |
    'runtime_reported' | 'unknown'
  coverageLevel: 'fine_grained' | 'run_level' | 'unknown'
  sourceAuthority: string
  sourceEvidenceIds: string[]
  firstEvidenceSequence: number
  lastEvidenceSequence: number
  revision: number
}
```

## Identity rules

- `source_event_key` only deduplicates source Evidence;
- `operationId` is derived from AgentRun + execution epoch + verified Core ID, Runtime stable ID, or Evidence ID;
- only equal operationId values merge lifecycle phases;
- title, command, cwd, time, provider and workspace diff never create identity.

## Mapping rules

- Core owns `activity-v1`;
- structured item/kind/catalog fields may determine `activityDomain` and `semanticKind`;
- `sourceAuthority === 'core'` plus current Tool Catalog validation is required before `canonicalTool` becomes authoritative;
- Runtime title is only `presentationHint`;
- a structured Runtime-reported tool identifier may populate `toolName` without proving unreported effects;
- insufficient evidence projects `unknown`.

## Lifecycle rules

- started/progress never imply a terminal outcome;
- explicit success/failure/denial/cancellation maps to the corresponding outcome;
- a terminal event without authoritative result is `unsettled`;
- conflicting terminal outcomes remain `unsettled` and preserve all Evidence IDs;
- Run completion does not synthesize child tool completion.

## Persistence rules

`canonical_runtime_activity` is a current, mutable Projection derived from immutable Evidence. One activity
Evidence write and its Projection insert/update commit atomically. The unique key is
`(agentRunId, executionEpoch, operationId, classifierVersion)`. It is rebuildable from Evidence and the
matching Mapping Registry version.

v0.41 has no identity replay, Binding Set or historical parallel grouping API. New classifier versions
apply to new operations; in-flight operations keep the version of their first Projection. Historical
reprojection requires a future explicit design.

## Renderer rules

Renderer may localize and lay out these fields, but cannot read provider title, command text or Runtime
name to classify an activity or correlate lifecycle. It displays `toolName`, then `presentationHint`, then
an activity-domain fallback, and exposes whether the name was Core-verified or Runtime-reported.
