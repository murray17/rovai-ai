---
document_type: contract
name: Camp Open Projection
version: v8
status: accepted
source_version: v1.29
last_updated: 2026-08-27
---

# Camp Open Projection v8

v8 replaces [v7](camp-open-projection-v7.md). Existing bounded collections, complete non-terminal Evidence,
attachment state, membership generation/reconciliation, coverage, pagination and read transaction remain unchanged.

`CampSnapshot.schemaVersion` becomes `34`; `CampOpenProjection.schemaVersion` becomes `5`. Both add required:

```ts
agentRunFileChanges: AgentRunFileChangesView[]
```

The collection contains only completed `(agentRunId, executionEpoch)` projections authorized to the opened Camp,
ordered by `completedAt`, Run identity and epoch. Internal `no_changes` checkpoints are omitted. Each summary contains
bounded file metadata and optional totals; complete detail remains behind the Camp-bound
`agentRunFileChanges.get(campId, agentRunId, executionEpoch)` read defined by
[Runtime File Change Observation v1](runtime-file-change-observation-v1.md).

The collection is historical timeline data, not a workspace scan and not a Canonical Activity list. Parallel Runs are
not merged. AgentRun file changes do not enter model context, message content, execution admission or Runtime bootstrap.

## References

- [Camp Open Projection v7](camp-open-projection-v7.md)
- [Runtime File Change Observation v1](runtime-file-change-observation-v1.md)
- [Camp Open Read Path](../architecture/camp-open-read-path.md)
