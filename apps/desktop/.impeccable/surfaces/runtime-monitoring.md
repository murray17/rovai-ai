---
version: 1
slug: "runtime-monitoring"
primary_target: "apps/desktop/src/renderer/src/RuntimeMonitoring.tsx"
related_targets:
  - "apps/desktop/src/renderer/src/styles.css"
  - "apps/desktop/src/renderer/src/CampNavigation.tsx"
  - "apps/desktop/src/renderer/src/App.tsx"
---

# Runtime monitoring surface brief

## User goal

Understand what happened after the current monitoring cutover without mistaking missing Runtime data,
estimates or aggregate billing for exact facts. The surface is read-only and belongs to the Settings
workspace support group.

## Composition and shared state

Use the shared borderless Settings header and centered `1040px` content track. Keep the clean-break
collection boundary visible above one horizontal Tab group: 概览、用量与成本、性能与可靠性. All three
views share one range/Runtime/member/terminal-status filter and one consistent snapshot. Moving between
Tabs preserves the filter and does not issue another query.

Do not turn metrics into a card wall. Use a compact keyline for the most important values, open ledgers
for sparse token or latency facts, and quiet tables for Runtime/model detail. Tables may scroll inside
their own bounded region; the page itself must not overflow horizontally. Long Runtime/model/currency
labels wrap or truncate with an accessible detail rather than widening the content track.

## Sparse facts and cost honesty

Every sparse metric presents its value with observed/eligible Coverage. Distinguish all three cases:

- no eligible Run;
- eligible Runs whose Runtime has not reported the field;
- an explicitly reported zero.

Keep cost quality, grain and currency visually separate. Runtime-reported values, estimates,
reconciled buckets and allocations never merge into an unlabeled total. Antigravity native Token,
Cache and cost remain unavailable until an authoritative upstream signal exists.

## State and refresh matrix

Support Loading, global Empty, Partial, Populated, Stale, Error and Export success/failure without
removing the Settings header, collection boundary or filters. A background refresh failure keeps the
last good snapshot visible, identifies its `observedAt` time and offers a local retry. The page never
starts Provider reconciliation or price synchronization.

Polling, event debounce, Usage flush cadence, rollup reads and database-lock boundaries are owned by
the [Runtime Monitoring contract](../../../../docs/contracts/runtime-monitoring-v1.md) and
[architecture](../../../../docs/architecture/runtime-monitoring.md); this brief does not duplicate
their numeric constants.

## Interaction and accessibility

Tabs use manual activation: arrow keys and Home/End move focus, while Enter/Space or click changes the
view. Filters have visible labels, unavailable values use `—` plus textual Coverage, and freshness,
errors and export results use appropriate live-region semantics. Do not rely on color or animation to
communicate availability.

Verify Day and Night at `1040×700` and `1440×920`, plus 200% zoom and reduced motion. Populated,
Partial, Stale and Error data must receive the same coverage as the clean-break Empty state.

## Inheritance and hard boundaries

Inherit [`settings-workspace.md`](settings-workspace.md), root [`DESIGN.md`](../../../../DESIGN.md), theme
and accessibility contracts. This brief controls information hierarchy and interaction only; it does
not redefine collection eligibility, Usage semantics, cost authority, Runtime compatibility or Core
persistence.
