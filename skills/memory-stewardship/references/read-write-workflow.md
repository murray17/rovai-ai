# Read, decide and write once

Read exact help for each needed `rovai memory view|search|read|write` operation.

## Capture: complete View before mutation

1. Form one atomic candidate and select its exact Scope.
2. View the global Hearth, your Companion, or the applicable set for you and one present Thread counterparty.
3. Require `complete: true` and `itemCount == items.length`; `totalBodyBytes` measures that full set. Stop on failure, incompleteness or inconsistency.
4. Compare every item. Equivalent: stop. The same understanding needs correction and `agentCanRevise: true`: revise. No equivalent and clear lasting value: add. Uncertain: stop.
5. For revise, copy the selected item's entire `target` unchanged. Core rechecks authority and Revision CAS. Mutual Relationship items support understanding and duplicate detection, not Agent revision.
6. Write once, without unrelated work between View and write. They are separate calls; CAS protects concurrent revision, while semantic duplicate adds are avoided only best effort.

Use `memory write` for Hearth too; there is no separate propose command. Inspect its outcome:

- `effective`: `memoryId` and `revisionId` identify immediately active Memory.
- `review_pending`: `reviewItemId` identifies a Hearth candidate awaiting the user; do not call it saved Memory.
- failure: follow safe recovery without claiming success or guessing/exposing other candidates' IDs, bodies or keys.

Revise changes only the body and complete key set. Do not create successive revisions for minor wording polish.

## Recall: Search, then Read

Use entrypoint IDs/keys as discovery hints. Search concrete concepts when needed (`limit` at most 6), then read likely matches (at most 4 IDs per call). Snippets are not authoritative bodies.

| Read state | Action |
| --- | --- |
| `current` | Use the returned current body |
| `revision_changed` | Replace cached wording and Revision ID with the returned values |
| `inactive`, `deleted`, `access_changed`, `unavailable` | Stop using the Memory; do not reconstruct its old body |

A current Read also returns `target` and `agentCanRevise`. If recall reveals a capture candidate, return to complete exact-Scope View before deciding to write.

## Examples

Companion add:

```json
{
  "action": "add",
  "scope": "companion",
  "kind": "preference",
  "body": "Distinguish confirmed decisions, assumptions and open questions in implementation plans.",
  "retrievalKeys": ["plan format", "confirmed", "open questions"]
}
```

Hearth add uses the same shape with `scope: "hearth"`. Relationship revise:

```json
{
  "action": "revise",
  "target": {
    "memoryId": "memory_123",
    "revisionId": "revision_456",
    "scope": "relationship",
    "counterpartyAgentId": "agent_3",
    "direction": "directed"
  },
  "body": "Include test commands, results and the matching commit in handoffs.",
  "retrievalKeys": ["handoff", "test results"]
}
```

Copy real targets from View/Read. Companion/Hearth targets omit the two Relationship fields.
