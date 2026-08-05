---
document_type: architecture
version: v0.41
authority: current-version-architecture
status: accepted
last_updated: 2026-08-05
---

# v0.41 Architecture: Current Canonical Runtime Activity Projection

## 1. Authority layers

| Layer | Owns | Must not do |
|---|---|---|
| Runtime Adapter | Normalize fields the Runtime actually reports | Invent hidden steps |
| Execution Evidence | Append-only observed facts and source identity | Store inferred semantics as facts |
| Core Mapping Registry | Versioned activity classification and strict operation identity | Fuzzy merge by text/time/provider |
| Canonical Activity Projection | Current lifecycle state for one observed operation | Become the immutable fact source |
| Renderer | Localization, detail, disclosure, visual state | Reclassify from title/command/Runtime name |

Execution Evidence remains the only immutable fact source. Canonical Activity is rebuildable derived state.

## 2. Operation identity

Core chooses identity in this order:

1. verified Core Action ID;
2. Runtime structured native ID (`toolCallId`, item ID or equivalent);
3. the Evidence ID itself.

The chosen identity is fenced by AgentRun and execution epoch before being hashed into `operationId`.
No title, command, cwd, timestamp, adjacency or workspace diff may merge operations.

`source_event_key` remains an Evidence dedupe key and never acts as lifecycle identity.

## 3. Current Projection write path

```text
normalize public Runtime event
  → insert append-only Evidence
  → calculate strict operationId
  → classify with activity-v1 Mapping Registry
  → INSERT/UPDATE canonical_runtime_activity
  → commit one SQLite transaction
```

The Projection unique key is:

```text
(agent_run_id, execution_epoch, operation_id, classifier_version)
```

The row holds current activity domain, optional semantic kind and tool name, presentation hint, phase,
outcome, provenance/coverage, Evidence IDs, first/last sequence and revision. started/progress/terminal
with the same operationId update this one row.

## 4. Mapping and presentation boundary

Activity classification reads structured fields such as Codex item type, ACP kind and verified Core Tool
Catalog identity. A Runtime title may be retained as `presentationHint`, but cannot determine domain or
prove an effect. Untrusted `canonicalTool` is ignored as semantic authority.

Renderer uses the Core projection only:

- `toolName` when the Runtime reported a structured name or Core validated a catalog name;
- otherwise Core `presentationHint`;
- otherwise a localized label for `activityDomain`;
- status from `phase + outcome`;
- icon from `activityDomain`.

## 5. Runtime coverage

All nine Adapter kinds share the contract. `fine_grained`, `run_level` and `unknown` describe observable
event detail, not product quality. Claude Code/Antigravity remain run-level unless their protocol actually
reports tool lifecycle; workspace changes never upgrade coverage.

## 6. Deferred infrastructure

v0.41 explicitly does not build identity version replay, operation registry, Binding Ledger, Binding Set,
sealed Manifest, staging/publish or default head. Evidence preserves enough input to revisit this if a real
historical regrouping requirement arrives. That future change requires a new ADR and migration design.

## 7. Determinism and tests

- duplicate source events return the existing Evidence/Projection;
- identical structured native IDs in one Run epoch merge lifecycle phases;
- missing IDs remain isolated;
- conflicting terminal outcomes project `unsettled`;
- live event and recovery read expose the same Canonical Activity shape;
- every Mapping Registry entry has Runtime-labelled fixtures and UI acceptance evidence.
