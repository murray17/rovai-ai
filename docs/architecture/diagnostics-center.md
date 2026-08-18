---
document_type: architecture
authority: diagnostics-center-component-boundary
status: accepted
last_updated: 2026-08-18
---

# Diagnostics Center Architecture

## Component authority

| Component | Responsibility |
| --- | --- |
| Core diagnostics module | Owns public status/group DTOs, summary aggregation, read-only SQLite quick check and the final v5 centralized redaction pass. |
| Core router | Composes current Core/Git/data-dir facts, stored Skill projection state, strict-read MCP inspection, persistent member Runtime selections and cached Runtime evidence into one `DiagnosticsReport`. |
| Skill projection reconciler | Exposes stored observation/root-access/dirty diagnostics without reading execution roots; explicit user reconcile remains a separate filesystem mutation. |
| MCP config store | Exposes `inspect` that never materializes a missing file; `get` and permission repair remain separate user-authorized operations. |
| Runtime platform admission + health cache | Supplies platform rows for the complete Product Runtime Catalog, but machine observations only for qualified Adapters and without rescan/probe scheduling. Runtime check remains an explicit qualified-product command. |
| Renderer Diagnostics Center | Owns Loading/Running/Partial/Error/Success/Disabled/Recovery presentation, attention-only issue projection, filters and the explicit action-to-Core mapping. |
| Electron Main / Preload | Allowlist the typed read method, broker Save Dialog, write v5 with the platform private atomic-write helper, and constrain host-file-manager reveal to the last successful session export. |
| Startup Recovery | Remains the only recovery surface when Core cannot open or migrate SQLite; Diagnostics Center is not a second Core startup mode. |

## Read and repair flows

```text
open page / run full self-check
  -> diagnostics.check
     -> read current facts only
     -> status + summary + checks
  -> Renderer derives issue list and filtered complete results

explicit single-item action
  -> one existing safe mutation or settings navigation
  -> diagnostics.check
  -> same check is ok: Success + replace report
     same check attention/unknown: preserve honest result
     read fails: Recovery + retain prior report

export
  -> diagnostics.export
     -> fresh read-only report + allowlisted aggregate counts
     -> centralized v5 redaction
  -> Electron platform-private atomic save
  -> exact-session host file-manager reveal
```

## Invariants

- No Renderer-derived health calculation can replace Core statuses or summary counts.
- `diagnostics.check` never invokes an operation whose purpose is reconcile, repair, rescan, probe, login,
  replacement or data mutation.
- `diagnostics.check` never resolves, canonicalizes, stats, or enumerates a historical Skill execution root;
  Observation is evidence, not filesystem access authority.
- `unknown` is evidence insufficiency and never enters the attention issue list.
- Runtime Catalog visibility and Runtime issue eligibility are different: all supported Adapters are visible, only selected
  platform-qualified unavailable products become attention. Not-qualified/unsupported rows never become machine health.
- Repair and its post-action read are a two-step protocol; mutation success alone is not health success.
- v5 is built from an allowlist and still receives a final recursive redaction pass; raw health/profile/camp objects
  never become export fields.

## References

- [ADR-0148](../adr/0148-read-only-diagnostics-and-data-minimized-export.md)
- [Diagnostics Center v1](../contracts/diagnostics-center-v1.md)
- [v0.51 production design](../versions/v0.51/production-design.md)
