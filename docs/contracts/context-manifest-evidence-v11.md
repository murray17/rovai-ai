---
document_type: contract
contract: context-manifest-evidence-v11
status: accepted
target_version: v0.54
last_updated: 2026-08-10
---

# ContextManifest Evidence v11

v11 freezes Formatter v13 exact AgentRun Dynamic Context bytes and replaces v10's ambiguous
self-active empty inclusion semantics. Public history, Collaboration State, Run Notice, attachment,
Skill/MCP and Bootstrap reference evidence otherwise remain unchanged. v10 is historical and is not
a current recovery reader.

## Self Active Task Evidence

Every Manifest persists one machine-only object and its canonical evidence digest. A non-empty or
partially budgeted projection has the existing shape:

```json
{
  "included": true,
  "selectedTaskRefs": [
    {"taskId": "task_…", "version": 4, "updatedAt": "2026-08-10T00:00:00Z"}
  ],
  "omittedCount": 2,
  "projectionDigest": "sha256:…"
}
```

When the authoritative candidate set is empty, Formatter v13 renders `{"tasks":[]}` and Evidence is:

```json
{
  "included": true,
  "selectedTaskRefs": [],
  "projectionDigest": "sha256:…"
}
```

When candidates existed but Runtime payload budget removed all selected entries, no section is
rendered and Evidence is:

```json
{
  "included": false,
  "selectedTaskRefs": [],
  "omittedCount": 3
}
```

`selectedTaskRefs` order exactly matches model projection order. `omittedCount` exists only when
positive. `projectionDigest` exists exactly when `included` is true and verifies Formatter's exact
compact JSON bytes. Evidence does not repeat title/status, identify omitted Tasks, grant Task
authority, or treat missing section as an empty candidate set.

## Freeze and recovery

Direct Runs select and persist inside the materialization critical section. A2A Delivery preselects
and freezes the same payload/evidence inside the Delivery transaction; Runtime materialization wraps
those frozen bytes without rereading live Tasks. Recovery reuses the original Manifest bytes.

Task projection has no freshness watermark, delta cursor or accepted-ACK state. Runtime Input
Delivery accepted ACK continues to advance only its existing public/Collaboration/Bootstrap
boundaries. Mutation still requires `task get` plus current Core authorization.

## Current-only migration

v11 requires Formatter 13 and Profile 3. Migration 71 removes incompatible ContextManifest, Runtime
Input Delivery, Bootstrap technical evidence and frozen A2A context; fences non-terminal execution;
and resets Native Binding context markers. Camp, Task, Message, Memory and other business history
remain. No nullable shim, dual reader or fallback projection is retained.
